/*
 * PDF reader for bank / M-Pesa statements.
 *
 * No dependencies, no network, no DOM. Reads the PDF bytes, decrypts the common
 * "Standard" security handler (RC4 40/128, the one Safaricom uses), inflates the
 * content streams, decodes the text with the font's ToUnicode map, and rebuilds
 * the table from the x/y position of every text run.
 *
 * Why hand-rolled: the whole product is one folder that opens from file://. A
 * 1.4 MB pdf.js bundle is a second thing to keep in sync, and it still does not
 * know that a transaction's Details wraps onto the next line.
 *
 * What it will not do: AES encryption, scanned (image-only) statements, tables
 * drawn as pictures. Each of those fails loudly with a code the page can explain.
 *
 * Load: <script src="pdf.js"></script>  -> window.ChamaPdf
 *       require("./pdf.js")            -> { extractTable, ... }
 *
 *   var table = await ChamaPdf.extractTable(bytes, "112797");
 *   // { headers: [...], rows: [[...]], pageCount: 2, warnings: [...] }
 *   // headers/rows are the same shape parseCsv() returns, so the rest of the
 *   // importer neither knows nor cares that this came from a PDF.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChamaPdf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- errors ---------- */

  function pdfError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /* ---------- bytes ---------- */

  function latin1(bytes) {
    var out = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return out;
  }

  function concat(list) {
    var length = 0;
    var i;
    for (i = 0; i < list.length; i += 1) length += list[i].length;
    var out = new Uint8Array(length);
    var at = 0;
    for (i = 0; i < list.length; i += 1) {
      out.set(list[i], at);
      at += list[i].length;
    }
    return out;
  }

  function utf8Text(bytes) {
    // ToUnicode destinations that are not plain 2-byte codes are UTF-16BE,
    // which is what this decodes. Falls back to latin1 for stray high bytes.
    var out = "";
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      var code = (bytes[i] << 8) | bytes[i + 1];
      out += String.fromCharCode(code);
    }
    return out;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== "function" || typeof Blob !== "function") {
      throw pdfError("NO_INFLATE", "This browser cannot uncompress PDF streams. Use a current Chrome, Edge or Firefox.");
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /* ---------- MD5 (only because browser WebCrypto has no MD5) ---------- */

  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  var MD5_K = (function () {
    var k = new Uint32Array(64);
    for (var i = 0; i < 64; i += 1) {
      k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }
    return k;
  })();

  function md5(bytes) {
    var len = bytes.length;
    var blocks = ((len + 8) >>> 6) + 1;
    var padded = new Uint8Array(blocks * 64);
    padded.set(bytes);
    padded[len] = 0x80;

    var bitsLow = (len << 3) >>> 0;
    var bitsHigh = Math.floor(len / 536870912) >>> 0;
    var end = padded.length;
    padded[end - 8] = bitsLow & 255;
    padded[end - 7] = (bitsLow >>> 8) & 255;
    padded[end - 6] = (bitsLow >>> 16) & 255;
    padded[end - 5] = (bitsLow >>> 24) & 255;
    padded[end - 4] = bitsHigh & 255;
    padded[end - 3] = (bitsHigh >>> 8) & 255;
    padded[end - 2] = (bitsHigh >>> 16) & 255;
    padded[end - 1] = (bitsHigh >>> 24) & 255;

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (var off = 0; off < padded.length; off += 64) {
      var m = new Uint32Array(16);
      for (var j = 0; j < 16; j += 1) {
        var p = off + j * 4;
        m[j] = (padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)) >>> 0;
      }

      var a = a0, b = b0, c = c0, d = d0;

      for (var i = 0; i < 64; i += 1) {
        var f, g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        var tmp = d;
        d = c;
        c = b;
        var x = (a + f + MD5_K[i] + m[g]) >>> 0;
        var sh = MD5_S[i];
        b = (b + ((x << sh) | (x >>> (32 - sh)))) >>> 0;
        a = tmp;
      }

      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    var out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (word, index) {
      out[index * 4] = word & 255;
      out[index * 4 + 1] = (word >>> 8) & 255;
      out[index * 4 + 2] = (word >>> 16) & 255;
      out[index * 4 + 3] = (word >>> 24) & 255;
    });
    return out;
  }

  /* ---------- RC4 ---------- */

  function rc4(key, data) {
    var s = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i += 1) s[i] = i;

    var j = 0;
    for (i = 0; i < 256; i += 1) {
      j = (j + s[i] + key[i % key.length]) & 255;
      var t = s[i];
      s[i] = s[j];
      s[j] = t;
    }

    var out = new Uint8Array(data.length);
    i = 0;
    j = 0;
    for (var n = 0; n < data.length; n += 1) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      var swap = s[i];
      s[i] = s[j];
      s[j] = swap;
      out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
  }

  /* ---------- objects ---------- */

  function scanObjects(text, bytes) {
    var objects = {};
    var order = [];
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var match;

    while ((match = re.exec(text))) {
      var num = Number(match[1]);
      var gen = Number(match[2]);
      var bodyStart = match.index + match[0].length;
      var end = text.indexOf("endobj", bodyStart);
      if (end === -1) end = text.length;

      var body = text.slice(bodyStart, end);
      var streamAt = body.indexOf("stream");
      var dict = body;
      var raw = null;

      if (streamAt !== -1) {
        // "endstream" is the only reliable delimiter: /Length may be indirect
        // or simply wrong in files produced by cheap generators. But when
        // /Length is a plain number it is exact, and the trailing EOL before
        // "endstream" must not be fed to the decompressor.
        dict = body.slice(0, streamAt);
        var dataAt = bodyStart + streamAt + 6;
        if (bytes[dataAt] === 13) dataAt += 1;
        if (bytes[dataAt] === 10) dataAt += 1;
        var dataEnd = text.indexOf("endstream", dataAt);
        if (dataEnd === -1) dataEnd = bytes.length;

        var declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
        if (declared) {
          var limit = dataAt + Number(declared[1]);
          if (limit <= dataEnd) dataEnd = limit;
        } else {
          while (dataEnd > dataAt && (bytes[dataEnd - 1] === 10 || bytes[dataEnd - 1] === 13)) dataEnd -= 1;
        }

        raw = bytes.subarray(dataAt, dataEnd);
      }

      objects[num] = { num: num, gen: gen, dict: dict, raw: raw };
      order.push(num);
    }

    return { byNum: objects, order: order };
  }

  function refOf(dict, key) {
    var m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dict || "");
    return m ? Number(m[1]) : null;
  }

  function nameOf(dict, key) {
    var m = new RegExp("/" + key + "\\s*/([A-Za-z0-9#_.+-]+)").exec(dict || "");
    return m ? m[1] : "";
  }

  /* ---------- decryption ---------- */

  var PASSWORD_PAD = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);

  function hexBytes(hex) {
    var clean = String(hex).replace(/\s/g, "");
    var out = new Uint8Array(Math.floor(clean.length / 2));
    for (var i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  function readEncryption(text) {
    var m = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(text);
    if (!m) return null;
    var encNum = Number(m[1]);

    var obj = new RegExp("(^|[^0-9])" + encNum + "\\s+\\d+\\s+obj([\\s\\S]*?)endobj").exec(text);
    if (!obj) throw pdfError("BAD_PDF", "The encryption dictionary is missing from this PDF.");

    var dict = obj[2].slice(0, obj[2].indexOf("stream") === -1 ? obj[2].length : obj[2].indexOf("stream"));
    var filter = nameOf(dict, "Filter");
    var v = Number((/\/V\s+(\d+)/.exec(dict) || [])[1] || 0);
    var r = Number((/\/R\s+(\d+)/.exec(dict) || [])[1] || 0);
    var lengthBits = Number((/\/Length\s+(\d+)/.exec(dict) || [])[1] || 40);

    var idMatch = /\/ID\s*\[\s*<([0-9A-Fa-f\s]+)>/.exec(text);
    var id = idMatch ? hexBytes(idMatch[1]) : new Uint8Array(0);

    var pMatch = /\/P\s+(-?\d+)/.exec(dict);

    return {
      filter: filter,
      v: v,
      r: r,
      lengthBits: lengthBits,
      o: hexBytes((/\/O\s*<([0-9A-Fa-f\s]+)>/.exec(dict) || [])[1] || ""),
      u: hexBytes((/\/U\s*<([0-9A-Fa-f\s]+)>/.exec(dict) || [])[1] || ""),
      p: pMatch ? Number(pMatch[1]) : 0,
      id: id,
      encryptMetadata: !/\/EncryptMetadata\s+false/.test(dict),
      aes: v >= 4 || /\/AESV/.test(dict),
    };
  }

  function padPassword(password) {
    var raw = new Uint8Array(password.length);
    for (var i = 0; i < password.length; i += 1) raw[i] = password.charCodeAt(i) & 255;
    if (raw.length >= 32) return raw.subarray(0, 32);
    var out = new Uint8Array(32);
    out.set(raw);
    out.set(PASSWORD_PAD.subarray(0, 32 - raw.length), raw.length);
    return out;
  }

  function pBytes(p) {
    var n = p | 0;
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function fileKey(enc, password) {
    var n = enc.r === 2 ? 5 : Math.max(5, Math.min(16, Math.floor(enc.lengthBits / 8)));
    var parts = [padPassword(password || ""), enc.o, pBytes(enc.p), enc.id];
    if (enc.r >= 4 && !enc.encryptMetadata) parts.push(new Uint8Array([255, 255, 255, 255]));

    var key = md5(concat(parts));
    if (enc.r >= 3) {
      for (var i = 0; i < 50; i += 1) key = md5(key.subarray(0, n));
    }
    return key.subarray(0, n);
  }

  function objectKey(key, num, gen) {
    var ext = new Uint8Array([
      num & 255, (num >>> 8) & 255, (num >>> 16) & 255,
      gen & 255, (gen >>> 8) & 255,
    ]);
    var digest = md5(concat([key, ext]));
    return digest.subarray(0, Math.min(key.length + 5, 16));
  }

  function bytesEqual(a, b, count) {
    if (a.length < count || b.length < count) return false;
    var diff = 0;
    for (var i = 0; i < count; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  // Algorithm 6 / 5: encrypt the padding with the file key and compare it with /U.
  // Without this an RC4 file "opens" with any password and only fails later, as a
  // confusing NO_TEXT or inflate error. Check the password up front instead.
  function passwordMatches(enc, key) {
    if (!enc.id || !enc.id.length || !enc.u || enc.u.length < 32) return true;

    if (enc.r === 2) return bytesEqual(rc4(key, PASSWORD_PAD), enc.u, 32);

    var digest = md5(concat([PASSWORD_PAD, enc.id]));
    var out = rc4(key, digest);
    for (var i = 1; i < 20; i += 1) {
      var stepKey = new Uint8Array(key.length);
      for (var j = 0; j < key.length; j += 1) stepKey[j] = key[j] ^ i;
      out = rc4(stepKey, out);
    }
    return bytesEqual(out, enc.u, 16);
  }

  /* ---------- document ---------- */

  async function open(bytes, password) {
    if (bytes.length < 8 || latin1(bytes.subarray(0, 5)) !== "%PDF-") {
      throw pdfError("NOT_PDF", "That file is not a PDF. If it is a CSV, choose it as a CSV instead.");
    }

    var text = latin1(bytes);
    var scan = scanObjects(text, bytes);
    var enc = readEncryption(text);
    var key = null;

    if (enc) {
      if (enc.filter && enc.filter !== "Standard") {
        throw pdfError("UNSUPPORTED_ENCRYPTION", "This PDF is protected by a security handler this tool does not know.");
      }
      if (enc.aes) {
        throw pdfError("UNSUPPORTED_ENCRYPTION",
          "This PDF uses AES encryption, which this reader does not support yet. Export the CSV instead.");
      }
      key = fileKey(enc, password);
      if (!passwordMatches(enc, key)) {
        throw pdfError("BAD_PASSWORD",
          "That password did not open this PDF. Check it against the one the statement asked for.");
      }
    }

    return {
      bytes: bytes,
      text: text,
      objects: scan.byNum,
      order: scan.order,
      enc: enc,
      key: key,
      cache: {},
    };
  }

  function isFlate(dict) {
    return /\/Filter\s*\/FlateDecode/.test(dict) || /\/Filter\s*\[\s*\/FlateDecode/.test(dict);
  }

  function streamOf(doc, num) {
    if (doc.cache[num]) return doc.cache[num];

    doc.cache[num] = (async function () {
      var obj = doc.objects[num];
      if (!obj || obj.raw === null) return null;

      var data = obj.raw;
      if (doc.key) data = rc4(objectKey(doc.key, obj.num, obj.gen), data);

      if (!isFlate(obj.dict)) {
        var filter = nameOf(obj.dict, "Filter");
        if (filter && filter !== "FlateDecode") return null;
        return data;
      }

      try {
        return await inflate(data);
      } catch (e) {
        if (e && e.code === "NO_INFLATE") throw e;
        throw pdfError("BAD_PASSWORD",
          "That password did not open this PDF. Check it against the one the statement asked for.");
      }
    })();

    return doc.cache[num];
  }

  /* ---------- page order ---------- */

  function pagesInOrder(doc) {
    var pages = [];
    var seen = {};

    function walk(num) {
      if (!num || seen[num]) return;
      seen[num] = true;
      var obj = doc.objects[num];
      if (!obj) return;
      if (/\/Type\s*\/Page[^s]/.test(obj.dict)) {
        pages.push(num);
        return;
      }
      var kids = /\/Kids\s*\[([^\]]*)\]/.exec(obj.dict);
      if (!kids) return;
      var re = /(\d+)\s+\d+\s+R/g;
      var m;
      while ((m = re.exec(kids[1]))) walk(Number(m[1]));
    }

    var rootMatch = /\/Root\s+(\d+)\s+\d+\s+R/.exec(doc.text);
    if (rootMatch) {
      var catalog = doc.objects[Number(rootMatch[1])];
      if (catalog) walk(refOf(catalog.dict, "Pages"));
    }

    if (!pages.length) {
      doc.order.forEach(function (num) {
        if (/\/Type\s*\/Page[^s]/.test(doc.objects[num].dict)) pages.push(num);
      });
    }

    return pages;
  }

  /* ---------- fonts ---------- */

  function hexToText(hex) {
    var bytes = hexBytes(hex);
    if (bytes.length === 1) return String.fromCharCode(bytes[0]);
    return utf8Text(bytes);
  }

  function parseCMap(text) {
    var map = {};
    var twoByte = false;
    var space = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
    if (space && /<[0-9A-Fa-f]{4}>/.test(space[1])) twoByte = true;

    var m;
    var bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bfchar.exec(text))) {
      var pairs = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g) || [];
      pairs.forEach(function (pair) {
        var p = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/.exec(pair);
        map[p[1].toUpperCase()] = p[2] ? hexToText(p[2]) : "";
      });
    }

    var bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrange.exec(text))) {
      var triples = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g) || [];
      triples.forEach(function (triple) {
        var p = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/.exec(triple);
        var from = parseInt(p[1], 16);
        var to = parseInt(p[2], 16);
        if (!p[3]) return;
        var width = p[1].length;
        var dst = parseInt(p[3], 16);
        for (var code = from; code <= to && code - from < 512; code += 1) {
          map[code.toString(16).toUpperCase().padStart(width, "0")] = String.fromCharCode(dst + (code - from));
        }
      });
    }

    return { map: map, twoByte: twoByte };
  }

  function fontMap(doc, pageNum) {
    var page = doc.objects[pageNum];
    var res = page.dict;
    var resRef = refOf(page.dict, "Resources");
    if (resRef && doc.objects[resRef]) res = doc.objects[resRef].dict;

    var fonts = {};
    var block = /\/Font\s*<<([\s\S]*?)>>/.exec(res);
    if (!block) return Promise.resolve(fonts);

    var re = /\/([A-Za-z0-9#_.+-]+)\s+(\d+)\s+\d+\s+R/g;
    var m;
    while ((m = re.exec(block[1]))) fonts[m[1]] = Number(m[2]);
    return Promise.resolve(fonts);
  }

  function fontFor(doc, num) {
    var cacheKey = "font:" + num;
    if (doc.cache[cacheKey]) return doc.cache[cacheKey];

    doc.cache[cacheKey] = (async function () {
      var obj = doc.objects[num];
      var cmap = { map: {}, twoByte: /Identity-H/.test(obj.dict) };
      var tu = refOf(obj.dict, "ToUnicode");

      if (tu) {
        var data = await streamOf(doc, tu);
        if (data) cmap = parseCMap(latin1(data));
      }

      return cmap;
    })();

    return doc.cache[cacheKey];
  }

  function decodeGlyphs(raw, font) {
    var out = "";
    var i;
    if (font.twoByte) {
      for (i = 0; i + 1 < raw.length; i += 2) {
        var code2 = ((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1)).toString(16).toUpperCase().padStart(4, "0");
        out += font.map[code2] !== undefined ? font.map[code2] : "";
      }
    } else {
      for (i = 0; i < raw.length; i += 1) {
        var code1 = raw.charCodeAt(i).toString(16).toUpperCase().padStart(2, "0");
        out += font.map[code1] !== undefined ? font.map[code1] : raw[i];
      }
    }
    return out;
  }

  /* ---------- content stream ---------- */

  var TOKEN = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\/[A-Za-z0-9#_.+-]+|-?\d*\.?\d+|[A-Za-z*'"]+/g;

  function unescapeString(raw) {
    return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, function (all, g) {
      if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
      return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[g] || g;
    });
  }

  async function pageText(doc, pageNum, pageIndex) {
    var page = doc.objects[pageNum];
    var contents = [];
    var ref = refOf(page.dict, "Contents");

    if (ref) contents.push(ref);
    else {
      var array = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
      if (array) {
        var re = /(\d+)\s+\d+\s+R/g;
        var m;
        while ((m = re.exec(array[1]))) contents.push(Number(m[1]));
      }
    }

    var chunks = [];
    for (var c = 0; c < contents.length; c += 1) {
      var data = await streamOf(doc, contents[c]);
      if (data) chunks.push(latin1(data));
    }

    var text = chunks.join("\n");
    if (!text) return [];

    var fonts = await fontMap(doc, pageNum);
    var items = [];
    var font = { map: {}, twoByte: false };
    var tm = [1, 0, 0, 1, 0, 0];
    var tlm = tm.slice();
    var leading = 0;
    var args = [];
    var tok;

    function emit(raw) {
      var str = decodeGlyphs(raw, font);
      if (str) items.push({ page: pageIndex, x: Math.round(tm[4] * 10) / 10, y: Math.round(tm[5] * 10) / 10, text: str });
    }

    while ((tok = TOKEN.exec(text))) {
      var t = tok[0];

      if (t.charAt(0) === "(") { args.push({ type: "str", v: unescapeString(t.slice(1, -1)) }); continue; }
      if (t.charAt(0) === "<" && t.charAt(1) !== "<") { args.push({ type: "hex", v: t.slice(1, -1).replace(/\s/g, "") }); continue; }
      if (t.charAt(0) === "/") { args.push({ type: "name", v: t.slice(1) }); continue; }
      if (/^-?\d*\.?\d+$/.test(t)) { args.push({ type: "num", v: Number(t) }); continue; }

      switch (t) {
        case "Tf": {
          var name = null;
          for (var a = args.length - 1; a >= 0; a -= 1) {
            if (args[a].type === "name") { name = args[a].v; break; }
          }
          if (name && fonts[name]) font = await fontFor(doc, fonts[name]);
          break;
        }
        case "Tm": {
          var six = args.filter(function (x) { return x.type === "num"; }).slice(-6).map(function (x) { return x.v; });
          if (six.length === 6) { tm = six.slice(); tlm = six.slice(); }
          break;
        }
        case "Td": case "TD": {
          var two = args.filter(function (x) { return x.type === "num"; }).slice(-2).map(function (x) { return x.v; });
          if (two.length === 2) {
            if (t === "TD") leading = -two[1];
            tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + two[0], tlm[5] + two[1]];
            tm = tlm.slice();
          }
          break;
        }
        case "T*":
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - leading];
          tm = tlm.slice();
          break;
        case "TL": {
          var last = args.filter(function (x) { return x.type === "num"; }).pop();
          if (last) leading = last.v;
          break;
        }
        case "Tj": {
          var one = args.filter(function (x) { return x.type === "str" || x.type === "hex"; }).pop();
          if (one) emit(one.v);
          break;
        }
        case "TJ":
          args.filter(function (x) { return x.type === "str" || x.type === "hex"; }).forEach(function (s) { emit(s.v); });
          break;
        case "'": case "\"": {
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - leading];
          tm = tlm.slice();
          var quoted = args.filter(function (x) { return x.type === "str" || x.type === "hex"; }).pop();
          if (quoted) emit(quoted.v);
          break;
        }
        case "BT":
          tm = [1, 0, 0, 1, 0, 0];
          tlm = tm.slice();
          break;
        default:
          break;
      }

      args.length = 0;
    }

    return items;
  }

  /* ---------- table ---------- */

  var MONEY = /^-?[\d,]+(\.\d{2})?$/;
  var STATUS = /^(completed|complete|failed|pending|reversed|cancelled|canceled|declined)$/i;
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

  function bandize(items) {
    var bands = [];
    items.slice().sort(function (a, b) {
      return b.y - a.y || a.x - b.x;
    }).forEach(function (item) {
      var band = bands.length ? bands[bands.length - 1] : null;
      if (!band || Math.abs(band.y - item.y) > 3) {
        band = { y: item.y, items: [] };
        bands.push(band);
      }
      band.items.push(item);
    });

    bands.forEach(function (band) {
      band.items.sort(function (a, b) { return a.x - b.x; });
    });
    return bands;
  }

  function bandText(band) {
    return band.items.map(function (i) { return i.text; }).join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function normaliseStatus(value) {
    var text = clean(value);
    if (/^completed?$/i.test(text)) return "COMPLETE";
    return text.toUpperCase();
  }

  function rowsFromItems(items, warnings) {
    var byPage = {};
    items.forEach(function (item) {
      (byPage[item.page] = byPage[item.page] || []).push(item);
    });

    var rows = [];
    var current = null;

    function flush() {
      if (!current) return;
      rows.push(current);
      current = null;
    }

    Object.keys(byPage).sort(function (a, b) { return a - b; }).forEach(function (page) {
      var bands = bandize(byPage[page]);

      // Start below the transaction table header, not at the top of the page:
      // the summary above it has "PAID IN"/"PAID OUT" headers of its own.
      var startAt = 0;
      for (var b = 0; b < bands.length; b += 1) {
        var text = bandText(bands[b]);
        if (/Receipt\s*No/i.test(text) && /Balance/i.test(text)) {
          startAt = b + 1;
          break;
        }
      }

      if (!startAt) {
        warnings.push("Page " + (Number(page) + 1) + ": no transaction table header found; read from the top.");
      }

      var dateX = null;
      var statusX = null;
      for (var h = Math.max(0, startAt - 1); h < bands.length; h += 1) {
        bands[h].items.forEach(function (item) {
          if (/^Completion/i.test(item.text) && dateX === null) dateX = item.x;
          if (/^Transaction\s*Status/i.test(item.text) && statusX === null) statusX = item.x;
        });
      }
      if (dateX === null) dateX = 108;
      if (statusX === null) statusX = 282;

      for (var i = startAt; i < bands.length; i += 1) {
        var band = bands[i];
        var joined = bandText(band);

        if (/^Disclaimer/i.test(joined) || /^Statement Verification/i.test(joined)) {
          flush();
          break;
        }

        var dateItem = null;
        var receiptItem = null;
        var statusItem = null;
        var details = [];
        var numbers = [];

        band.items.forEach(function (item) {
          var value = clean(item.text);
          if (!value) return;

          if (!dateItem && ISO_DATE.test(value)) {
            dateItem = item;
            return;
          }

          if (dateItem && item.x > dateX + 120) {
            // to the right of the date column: status, amount, balance
            if (STATUS.test(value)) statusItem = item;
            else if (MONEY.test(value) && item.x > statusX - 5) numbers.push({ x: item.x, value: value });
            else if (!receiptItem) details.push(value);
            return;
          }

          if (item.x < dateX - 8) {
            if (!receiptItem) receiptItem = item;
            return;
          }

          details.push(value);
        });

        // The date is the anchor: a band without one is a wrapped Details line
        // only when a transaction is already open.
        if (dateItem) {
          flush();
          numbers.sort(function (a, b) { return a.x - b.x; });

          var amount = numbers.length >= 2 ? numbers[numbers.length - 2].value : "";
          var balance = numbers.length >= 1 ? numbers[numbers.length - 1].value : "";

          current = {
            receipt: receiptItem ? clean(receiptItem.text) : "",
            date: clean(dateItem.text),
            details: details.join(" "),
            status: statusItem ? normaliseStatus(statusItem.text) : "",
            amount: amount,
            balance: balance,
            extra: [],
          };
          continue;
        }

        if (current) current.extra.push(joined);
      }
    });

    flush();
    return rows;
  }

  function tableOf(rows) {
    var headers = ["Receipt No.", "Completion Time", "Details", "Transaction Status", "Paid In", "Withdrawn", "Balance"];
    var out = rows.map(function (row) {
      var negative = /^-/.test(row.amount);
      var value = row.amount.replace(/[-,]/g, "");
      var details = [row.details].concat(row.extra).filter(function (part) { return part; }).join(" ");
      return [
        row.receipt,
        row.date,
        clean(details),
        row.status,
        negative ? "" : value,
        negative ? value : "",
        row.balance.replace(/-/g, ""),
      ];
    });

    return { headers: headers, rows: out };
  }

  /* ---------- public ---------- */

  async function extractTable(bytes, password) {
    var doc = await open(bytes, password);
    var pages = pagesInOrder(doc);

    if (!pages.length) throw pdfError("NO_PAGES", "This PDF has no readable pages.");

    var items = [];
    for (var i = 0; i < pages.length; i += 1) {
      var pageItems = await pageText(doc, pages[i], i);
      items = items.concat(pageItems);
    }

    var warnings = [];

    if (!items.length) {
      throw pdfError("NO_TEXT",
        "This PDF has no text layer — it looks like a scan or a picture. Export the CSV, or type the figures in by hand.");
    }

    var rows = rowsFromItems(items, warnings);

    if (!rows.length) {
      throw pdfError("NO_TABLE",
        "Text was found, but not a transaction table. The statement format may have changed; export the CSV instead.");
    }

    var table = tableOf(rows);
    table.pageCount = pages.length;
    table.warnings = warnings;
    return table;
  }

  return {
    extractTable: extractTable,
    // exported for tests
    md5: md5,
    rc4: rc4,
    parseCMap: parseCMap,
    rowsFromItems: rowsFromItems,
    bandize: bandize,
  };
});
