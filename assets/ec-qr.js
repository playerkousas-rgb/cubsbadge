/* ============================================================
 * ec-qr.js — 分享 QR 產生器 (BUILD.md §5)
 *
 * 「已發佈公開項目有『分享』掣 → WhatsApp／複製連結／QR」
 * 「QR／連結永不帶 key」—— 所以 QR 內容只係一條公開 URL。
 *
 * 零依賴、零網絡：唔用第三方 QR 服務（唔會將分享連結送去人哋伺服器），
 * 亦符合 §10 體積治理（api 零依賴、bundle 細）。
 *
 * 實作：QR Model 2，byte mode，EC level L，自動揀 version 同 mask。
 * ============================================================ */
(function (global) {
  'use strict';

  // ---- EC-L 表（index = version, 1..40）----
  var ECC_PER_BLOCK = [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  var NUM_BLOCKS = [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];
  var ECL_FORMAT_BITS = 1; // L

  // ---- GF(256) ----
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var i = 0; i < data.length; i++) {
      var factor = (data[i] ^ result[0]) & 0xFF;
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var j = 0; j < result.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  // ---- 容量計算 ----
  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }
  function alignPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26 : Math.floor((ver * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    var size = ver * 4 + 17;
    var result = [6];
    for (var i = 0, pos = size - 7; i < numAlign - 1; i++, pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xFFFF) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // ---- 位元流 ----
  function buildCodewords(bytes, ver) {
    var bits = [];
    function append(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    append(4, 4); // byte mode
    append(bytes.length, ver <= 9 ? 8 : (ver <= 26 ? 16 : 16));
    bytes.forEach(function (b) { append(b, 8); });

    var capacityBits = numDataCodewords(ver) * 8;
    if (bits.length > capacityBits) return null;
    for (var i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var pads = [0xEC, 0x11], p = 0;
    while (bits.length < capacityBits) { append(pads[p % 2], 8); p++; }

    var cw = new Uint8Array(bits.length / 8);
    for (var k = 0; k < bits.length; k++) cw[k >>> 3] |= bits[k] << (7 - (k & 7));
    return cw;
  }

  function addEcc(data, ver) {
    var numBlocks = NUM_BLOCKS[ver];
    var blockEccLen = ECC_PER_BLOCK[ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var divisor = rsDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = Array.prototype.slice.call(data, k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0); // 佔位，交錯時跳過
      blocks.push(dat.concat(Array.prototype.slice.call(ecc)));
    }

    var result = [];
    for (var j = 0; j < blocks[0].length; j++) {
      for (var b = 0; b < blocks.length; b++) {
        if (j !== shortBlockLen - blockEccLen || b >= numShortBlocks) result.push(blocks[b][j]);
      }
    }
    return result;
  }

  // ---- 矩陣 ----
  function newMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(false));
    return m;
  }

  function drawFunctionPatterns(modules, isFunc, ver) {
    var size = modules.length;
    function setFn(x, y, dark) {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      modules[y][x] = dark; isFunc[y][x] = true;
    }
    // timing
    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    // finder + separator
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(c[0] + dx, c[1] + dy, dist !== 2 && dist !== 4);
      }
    });
    // alignment
    var pos = alignPositions(ver);
    var n = pos.length;
    for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
        setFn(pos[a] + dx2, pos[b] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
      }
    }
    // format 預留（實際值稍後畫）
    drawFormatBits(modules, isFunc, 0);
    // version info (v>=7)
    if (ver >= 7) {
      var rem = ver;
      for (var k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = (ver << 12) | rem;
      for (var t = 0; t < 18; t++) {
        var bit = ((bits >>> t) & 1) === 1;
        var aa = size - 11 + (t % 3), bb = Math.floor(t / 3);
        setFn(aa, bb, bit); setFn(bb, aa, bit);
      }
    }
  }

  function drawFormatBits(modules, isFunc, mask) {
    var size = modules.length;
    var data = (ECL_FORMAT_BITS << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(k) { return ((bits >>> k) & 1) === 1; }
    function setFn(x, y, dark) { modules[y][x] = dark; isFunc[y][x] = true; }

    for (var i1 = 0; i1 <= 5; i1++) setFn(8, i1, bit(i1));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (var i2 = 9; i2 < 15; i2++) setFn(14 - i2, 8, bit(i2));

    for (var i3 = 0; i3 < 8; i3++) setFn(size - 1 - i3, 8, bit(i3));
    for (var i4 = 8; i4 < 15; i4++) setFn(8, size - 15 + i4, bit(i4));
    setFn(8, size - 8, true); // always dark
  }

  function drawCodewords(modules, isFunc, data) {
    var size = modules.length;
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? (size - 1 - vert) : vert;
          if (!isFunc[y][x] && i < data.length * 8) {
            modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
    return i;
  }

  function applyMask(modules, isFunc, mask) {
    var size = modules.length;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (isFunc[y][x]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: invert = false;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  }

  function penalty(modules) {
    var size = modules.length, result = 0;
    var N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    // 行 / 列 連續同色
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < size; i++) {
        var runColor = false, runLen = 0;
        var history = [0, 0, 0, 0, 0, 0, 0];
        for (var j = 0; j < size; j++) {
          var c = pass === 0 ? modules[i][j] : modules[j][i];
          if (c === runColor) {
            runLen++;
            if (runLen === 5) result += N1;
            else if (runLen > 5) result++;
          } else {
            addHistory(history, runLen);
            if (!runColor) result += finderPenalty(history, N3);
            runColor = c; runLen = 1;
          }
        }
        addHistory(history, runLen + (runColor ? 0 : 0));
        if (runColor) addHistory(history, 0);
        result += finderPenalty(history, N3);
      }
    }
    // 2x2 同色
    for (var y = 0; y < size - 1; y++) for (var x = 0; x < size - 1; x++) {
      var c0 = modules[y][x];
      if (c0 === modules[y][x + 1] && c0 === modules[y + 1][x] && c0 === modules[y + 1][x + 1]) result += N2;
    }
    // 黑白比例
    var dark = 0;
    modules.forEach(function (row) { row.forEach(function (c) { if (c) dark++; }); });
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;
    return result;
  }
  function addHistory(history, len) { history.pop(); history.unshift(len); }
  function finderPenalty(h, N3) {
    var n = h[1];
    if (n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n) {
      return ((h[0] >= n * 4 || h[6] >= n * 4) ? N3 : 0);
    }
    return 0;
  }

  /**
   * 生成 QR 矩陣（boolean[][]）。太長會回 null（呢種情況只顯示連結，唔畫 QR）。
   * @param {string} text  純文字／URL（永不放 apikey 或 session token）
   */
  function encode(text, opts) {
    opts = opts || {};
    var bytes = toUtf8Bytes(String(text));
    var ver = 0, cw = null;
    for (var v = 1; v <= 40; v++) {
      cw = buildCodewords(bytes, v);
      if (cw) { ver = v; break; }
    }
    if (!ver) return null;

    var size = ver * 4 + 17;
    var modules = newMatrix(size);
    var isFunc = newMatrix(size);
    drawFunctionPatterns(modules, isFunc, ver);
    drawCodewords(modules, isFunc, addEcc(cw, ver));

    var forced = (opts.mask === undefined || opts.mask === null) ? -1 : opts.mask;
    var bestMask = forced, bestScore = Infinity;
    if (forced < 0) {
      for (var m = 0; m < 8; m++) {
        applyMask(modules, isFunc, m);
        drawFormatBits(modules, isFunc, m);
        var s = penalty(modules);
        if (s < bestScore) { bestScore = s; bestMask = m; }
        applyMask(modules, isFunc, m); // 還原
      }
    }
    applyMask(modules, isFunc, bestMask);
    drawFormatBits(modules, isFunc, bestMask);
    return { modules: modules, version: ver, mask: bestMask, size: size };
  }

  /** QR → SVG 字串。 */
  function toSvg(text, opts) {
    opts = opts || {};
    var qr = encode(text, opts);
    if (!qr) return '';
    var scale = opts.scale || 4, quiet = opts.quiet == null ? 4 : opts.quiet;
    var size = qr.size, dim = (size + quiet * 2) * scale;
    var rects = '';
    for (var r = 0; r < size; r++) {
      var run = 0;
      for (var c = 0; c <= size; c++) {
        if (c < size && qr.modules[r][c]) { run++; continue; }
        if (run) {
          rects += '<rect x="' + ((c - run + quiet) * scale) + '" y="' + ((r + quiet) * scale) +
            '" width="' + (run * scale) + '" height="' + scale + '"/>';
          run = 0;
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<g fill="#000000">' + rects + '</g></svg>';
  }

  var api = { encode: encode, toSvg: toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ECQr = api;
})(typeof window !== 'undefined' ? window : this);
