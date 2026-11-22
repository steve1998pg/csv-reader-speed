// SPDX-License-Identifier: MIT
// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Same answers as csv-reader 1.0.0 on every input. Speed comes from:
//   - jumping between delimiters with indexOf and slicing whole fields at
//     once (the reference builds every field a character at a time);
//   - one line-end lookup per physical line, cached in `le`: an unquoted
//     field ends at the next comma before `le`, or at `le` itself, so the
//     common unquoted field costs one indexOf(',') plus one slice;
//   - the per-field stray-CR scan skipped on lines already known to hold
//     no CR (`leClean`);
//   - the segment-joining work only for the rare fields that need it
//     (doubled quotes, line breaks inside quotes, stray CRs, junk after a
//     closing quote, an unterminated quote).
//
// The broken-row policy is csv-reader's own, kept exactly:
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; what follows its closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when the
//     field ends); a quote that never closes is a literal character, and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     field count) or cut (long_row, with extra: the cut fields) to the
//     first record's width;
//   - each error is {code, line, row}, in the order met; line is the
//     1-based line its record starts on, counting every LF, CRLF and lone
//     CR inside quotes, and row is its record's index in rows, null for
//     the header.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** Count line breaks in a quoted field's raw content: LF, plus CR unless it is part of CRLF. */
function countBreaks(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) n++;
    else if (c === 13) {
      n++;
      if (s.charCodeAt(i + 1) === 10) i++;
    }
  }
  return n;
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors raised while reading it carry these.
  let recordLine = 1;
  let recordRow = null;

  // Index of the LF ending the physical line `pos` is on, or `len` when
  // the text ends without one. Only a quoted field can move `pos` past
  // it, so it is refreshed lazily (see below). `leClean` says the stretch
  // from where `le` was computed to the line's content end holds no CR,
  // so no field on it can hold a stray one.
  let le = -1;
  let leClean = true;

  /** Recompute `le` and `leClean` for the line starting at `from`. */
  function refreshLine(from) {
    le = text.indexOf('\n', from);
    if (le === -1) le = len;
    const ce = le < len && text.charCodeAt(le - 1) === 13 ? le - 1 : le;
    leClean = text.slice(from, ce).indexOf('\r') === -1;
  }

  // Read an unquoted field starting at `start`, with `prefix` already in
  // front of it ("" for a plain field, '"' for a quote that never closed,
  // the quoted value for junk after a closing quote). Used only for the
  // rare paths; the common unquoted field is inlined in the record loop.
  // Results come back through the locals `uVal`, `uEnd`, `uAdded`
  // (characters kept from the scan itself, not counting `prefix` or
  // dropped CRs).
  let uVal;
  let uEnd;
  let uAdded;
  function readUnquoted(start, prefix) {
    let p = start;
    let c = text.indexOf(',', p);
    if (c === -1) c = 1e9;
    let n = text.indexOf('\n', p);
    if (n === -1) n = 1e9;
    let e = c < n ? c : n;
    let en;
    if (e >= 1e9) {
      e = len;
      en = END;
    } else if (c < n) en = COMMA;
    else en = BREAK;
    // A CR right before the LF is the CRLF line break, not field content.
    const ce = en === BREAK && e > p && text.charCodeAt(e - 1) === 13 ? e - 1 : e;
    const v = text.slice(p, ce);
    if (v.indexOf('\r') === -1) {
      uAdded = ce - p;
      uVal = prefix ? prefix + v : v;
      pos = en === END ? len : e + 1;
      if (en === BREAK) line++;
      uEnd = en;
      return;
    }
    // Rare: one or more lone CRs inside the field. Drop each (one
    // stray_cr error each) and keep the rest. Every CR left in the slice
    // is lone: a CR followed by LF would be the one at ce, already cut.
    let kept = 0;
    let out = '';
    let from = 0;
    for (let i = 0; i < v.length; i++) {
      if (v.charCodeAt(i) === 13) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        out += v.slice(from, i);
        kept += i - from;
        from = i + 1;
      }
    }
    out += v.slice(from);
    kept += v.length - from;
    uAdded = kept;
    uVal = prefix ? prefix + out : out;
    pos = en === END ? len : e + 1;
    if (en === BREAK) line++;
    uEnd = en;
  }

  // Drop every lone CR in `v` (each one a stray_cr error) and return what
  // is kept. Only called for a field already known to hold a CR.
  function stripCRs(v) {
    let out = '';
    let from = 0;
    for (let i = 0; i < v.length; i++) {
      if (v.charCodeAt(i) === 13) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        out += v.slice(from, i);
        from = i + 1;
      }
    }
    return out + v.slice(from);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    refreshLine(pos);
    const fields = [];
    let lastQuoted = false;
    let ended;

    do {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        lastQuoted = true;
        const open = pos;
        let seg = pos + 1;
        let parts = null;
        let q = seg;
        let closed = -1;
        while (true) {
          q = text.indexOf('"', q);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(text.slice(seg, q));
            parts.push('"');
            q += 2;
            seg = q;
            continue;
          }
          closed = q;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted(open + 1, '"');
          fields.push(uVal);
          ended = uEnd;
          continue;
        }
        let raw;
        if (parts === null) raw = text.slice(seg, closed);
        else {
          parts.push(text.slice(seg, closed));
          raw = parts.join('');
        }
        if (raw.indexOf('\n') !== -1 || raw.indexOf('\r') !== -1) {
          line += countBreaks(raw);
          raw = raw.replace(/\r\n?/g, '\n');
        }
        pos = closed + 1;
        if (pos >= len) {
          fields.push(raw);
          ended = END;
          continue;
        }
        const cc = text.charCodeAt(pos);
        if (cc === 44) {
          fields.push(raw);
          pos++;
          ended = COMMA;
          continue;
        }
        if (cc === 10) {
          fields.push(raw);
          pos++;
          line++;
          ended = BREAK;
          continue;
        }
        if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
          fields.push(raw);
          pos += 2;
          line++;
          ended = BREAK;
          continue;
        }
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break. Its stray_cr errors (if any) come
        // first; quote_junk follows only when anything was kept.
        readUnquoted(pos, raw);
        if (uAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(uVal);
        ended = uEnd;
      } else {
        // An unquoted field: it ends at the next comma before the end of
        // its line, or at the line's end. `le` is refreshed when a quoted
        // field has moved `pos` past it.
        lastQuoted = false;
        const p = pos;
        if (p > le) refreshLine(p);
        const c = text.indexOf(',', p);
        if (c !== -1 && c < le) {
          const v = text.slice(p, c);
          fields.push(leClean || v.indexOf('\r') === -1 ? v : stripCRs(v));
          pos = c + 1;
          ended = COMMA;
        } else if (le >= len) {
          const v = text.slice(p, len);
          fields.push(leClean || v.indexOf('\r') === -1 ? v : stripCRs(v));
          pos = len;
          ended = END;
        } else {
          // The line ends at `le` (the LF); a CR right before it is the
          // CRLF line break, not field content.
          const ce = le > p && text.charCodeAt(le - 1) === 13 ? le - 1 : le;
          const v = text.slice(p, ce);
          fields.push(leClean || v.indexOf('\r') === -1 ? v : stripCRs(v));
          pos = le + 1;
          line++;
          ended = BREAK;
        }
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
