function __olpInit() {
  'use strict';
  // Prevent double-injection
  if (document.getElementById('olWillProofreader')) {
    document.getElementById('olWillProofreader').remove();
  }

  /* ── STATE ── */
  var S = {
    consultationId: null,
    attachments: [],
    documents: [],
    extractedPersons: [],
    proofOfAddress: [],
    wills: [],  // Array of {name, text, blobUrl} for up to 2 wills
    apiKey: localStorage.getItem('ol_proofreader_apikey') || ''
  };

  var DOCTYPE_NAMES = {
    proofOfIdDrivingLicense: 'Driving Licence',
    proofOfIdPassport: 'Passport',
    proofOfIdProvisionalDrivingLicense: 'Provisional Licence',
    proofOfIdPhotoBusPass: 'Photo Bus Pass',
    proofOfAddressCouncilTaxBill: 'Council Tax Bill',
    proofOfAddressBankStatement: 'Bank Statement',
    proofOfAddressUtilityBill: 'Utility Bill',
    proofOfAddressOther: 'Other'
  };

  /* ── CREATE PANEL ── */
  var panel = document.createElement('div');
  panel.id = 'olWillProofreader';
  panel.innerHTML = buildHTML();
  document.body.appendChild(panel);
  addStyles();

  /* ── WIRE UP EVENTS ── */
  var $ = function(id) { return document.getElementById(id); };
  $('olp-close').onclick = function() { panel.remove(); };
  $('olp-minimize').onclick = function() {
    var body = $('olp-body');
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };
  $('olp-save-key').onclick = saveKey;
  $('olp-extract').onclick = function() { runPipeline(); };
  $('olp-verify').onclick = runVerification;
  $('olp-save-will').onclick = saveWillText;
  $('olp-settings-toggle').onclick = function() {
    var s = $('olp-settings');
    s.style.display = s.style.display === 'none' ? 'block' : 'none';
  };
  $('olp-split-view').onclick = openSplitView;

  // PDF upload handlers
  var pdfDrop = $('olp-pdf-drop');
  var pdfInput = $('olp-pdf-input');
  pdfDrop.onclick = function() { pdfInput.click(); };
  pdfInput.onchange = function() { if (pdfInput.files[0]) handlePdfUpload(pdfInput.files[0]); };
  pdfDrop.ondragover = function(e) { e.preventDefault(); pdfDrop.style.borderColor = '#6366f1'; pdfDrop.style.background = '#6366f122'; };
  pdfDrop.ondragleave = function() { pdfDrop.style.borderColor = '#444'; pdfDrop.style.background = 'transparent'; };
  pdfDrop.ondrop = function(e) {
    e.preventDefault();
    pdfDrop.style.borderColor = '#444'; pdfDrop.style.background = 'transparent';
    var file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePdfUpload(file);
    else addLog('ERROR: Please drop a PDF file');
  };

  // Auto-start if we have a key (settings stay hidden)
  if (S.apiKey) {
    $('olp-key-input').value = S.apiKey;
    $('olp-loading').style.display = 'block';
    runPipeline();
  } else {
    // No key — show settings
    $('olp-settings').style.display = 'block';
    $('olp-results').innerHTML = '<div style="color:#888;padding:8px;font-size:11px;">Enter API key above to start</div>';
  }

  /* ── SAVE KEY ── */
  function saveKey() {
    var key = $('olp-key-input').value.trim();
    if (!key || !key.startsWith('sk-ant-')) {
      $('olp-key-status').innerHTML = '<span style="color:#f87171">&#9679;</span> Invalid key';
      return;
    }
    S.apiKey = key;
    localStorage.setItem('ol_proofreader_apikey', key);
    $('olp-key-status').innerHTML = '<span style="color:#4ade80">&#9679;</span> Key saved!';
    if (S.documents.length === 0) runPipeline();
  }

  /* ── ATTACHMENT SCANNER ── */
  function scanForAttachments(currentConsultationId) {
    var attachments = [];
    var seen = {};
    var regex = /consultationId[\\]*":[\\]*"([^"]+)[\\]*",[\\]*"attachmentId[\\]*":[\\]*"([^"]+)[\\]*",[\\]*"filename[\\]*":[\\]*"([^"]+)[\\]*",[\\]*"documentType[\\]*":[\\]*"([^"]+)[\\]*"/g;
    var sources = [];
    document.querySelectorAll('script').forEach(function(s) { sources.push(s.textContent || ''); });
    sources.push(document.body.innerHTML || '');
    sources.forEach(function(text) {
      regex.lastIndex = 0;
      var m;
      while ((m = regex.exec(text)) !== null) {
        var att = {
          consultationId: m[1].replace(/\\/g, ''),
          attachmentId:   m[2].replace(/\\/g, ''),
          filename:       m[3].replace(/\\/g, ''),
          documentType:   m[4].replace(/\\/g, '')
        };
        // Only keep attachments belonging to the current consultation
        if (att.consultationId !== currentConsultationId) continue;
        if (!seen[att.attachmentId]) { seen[att.attachmentId] = true; attachments.push(att); }
      }
    });
    return attachments;
  }

  /* ── MAIN PIPELINE ── */
  async function runPipeline() {
    var log = $('olp-log');
    log.textContent = '';
    addLog('Starting...');
    $('olp-loading').style.display = 'block';
    $('olp-loading-text').textContent = 'Finding documents...';

    // Step 1: Get consultation ID
    var urlMatch = window.location.pathname.match(/\/consultations\/([a-f0-9-]+)/);
    if (!urlMatch) { addLog('ERROR: Not on a consultation page'); $('olp-loading').style.display = 'none'; return; }
    S.consultationId = urlMatch[1];
    addLog('Consultation: ' + S.consultationId.substring(0, 8) + '...');

    // Step 2: Extract attachments - auto-scroll to trigger lazy loading if needed
    S.attachments = scanForAttachments(S.consultationId);

    if (S.attachments.length === 0) {
      addLog('Scrolling to load attachments...');
      $('olp-loading-text').textContent = 'Loading attachments...';
      var totalHeight = document.body.scrollHeight;
      var steps = 5;
      for (var s = 1; s <= steps; s++) {
        window.scrollTo(0, Math.floor((totalHeight / steps) * s));
        await new Promise(function(r) { setTimeout(r, 700); });
        S.attachments = scanForAttachments(S.consultationId);
        if (S.attachments.length > 0) break;
      }
      window.scrollTo(0, 0);
    }

    addLog('Found ' + S.attachments.length + ' documents');

    if (S.attachments.length === 0) {
      $('olp-loading').style.display = 'none';
      $('olp-results').innerHTML = '<div style="color:#f87171;padding:8px;font-size:11px;">No documents found on this consultation.</div>';
      return;
    }

    $('olp-loading-text').textContent = 'Extracting ' + S.attachments.length + ' document(s)...';

    // Step 3: Download, compress, and extract each document IN PARALLEL
    S.documents = [];
    S.extractedPersons = [];
    S.proofOfAddress = [];

    var promises = S.attachments.map(function(att) {
      return processOneDocument(att);
    });
    await Promise.all(promises);

    $('olp-loading').style.display = 'none';
    addLog('DONE! ' + S.extractedPersons.length + ' person(s) extracted');
    renderResults();
  }

  async function processOneDocument(att) {
    var typeName = DOCTYPE_NAMES[att.documentType] || att.documentType;
    var isProof = att.documentType.indexOf('proofOfAddress') !== -1;
    addLog('Fetching ' + typeName + '...');

    try {
      // Get signed URL
      var t0 = Date.now();
      var resp = await fetch('/api/consultations/' + att.consultationId + '/attachment/' + att.attachmentId, { credentials: 'include' });
      if (!resp.ok) { addLog('ERROR: API ' + resp.status + ' for ' + typeName); return; }
      var data = await resp.json();
      var imageUrl = data.downloadUrl || data.signedUrl || data.url;
      if (!imageUrl) { addLog('ERROR: No URL for ' + typeName); return; }

      // Download blob
      var imgResp = await fetch(imageUrl);
      var blob = await imgResp.blob();
      var t1 = Date.now();
      addLog(typeName + ' downloaded (' + (t1 - t0) + 'ms, ' + (blob.size / 1024).toFixed(0) + 'KB)');

      // Compress
      var blobUrl = URL.createObjectURL(blob);
      var dataUrl = await new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height, maxDim = 1400;
          if (w > h) { if (w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; } }
          else { if (h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; } }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(blobUrl);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function() { URL.revokeObjectURL(blobUrl); resolve(null); };
        img.src = blobUrl;
      });

      if (!dataUrl) { addLog('ERROR: Compress failed for ' + typeName); return; }

      var doc = {
        filename: att.filename,
        documentType: att.documentType,
        type: isProof ? 'proof' : 'id',
        imageDataUrl: dataUrl
      };
      S.documents.push(doc);
      addLog(typeName + ' compressed (' + (dataUrl.length * 0.75 / 1024).toFixed(0) + 'KB)');

      // Extract with Claude API if we have a key
      if (!S.apiKey) {
        addLog('Skipping extraction - no API key');
        return;
      }

      addLog('Extracting ' + typeName + ' with AI...');
      var t2 = Date.now();
      var match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      var prompt = isProof
        ? 'Extract ONLY text you can actually see printed on this document. Do NOT guess or infer any part of the address. Pay EXTREME attention to the house number — getting 8 vs 9, 1 vs 7, 6 vs 5, etc. wrong is a critical error. If a line is unclear, write "[unclear]" for that part. Return ONLY JSON: {"fullName":"","address":"","postcode":"","documentType":""}. The postcode must be copied exactly as printed.'
        : 'Extract ONLY text you can actually see printed on this UK ID document. Do NOT guess or infer any information. Pay EXTREME attention to the house number in the address — getting a single digit wrong (e.g. 8 vs 9, 1 vs 7, 6 vs 5) is a critical error. Look very carefully at the number. If something is unclear, write "[unclear]". Copy the postcode exactly as printed. Return ONLY JSON: {"title":"","surname":"","firstNames":"","dob":"DD.MM.YYYY","address":"","postcode":"","documentNumber":""}. The postcode MUST be a separate field copied exactly from the document.';

      var apiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': S.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!apiResp.ok) {
        var errText = await apiResp.text();
        addLog('ERROR: Claude API ' + apiResp.status);
        return;
      }

      var result = await apiResp.json();
      var responseText = (result.content && result.content[0] && result.content[0].text) || '';
      var jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { addLog('ERROR: Could not parse response for ' + typeName); return; }

      var person = JSON.parse(jsonMatch[0]);
      person.sourceDoc = att.filename;
      person.documentType = att.documentType;

      if (isProof) {
        S.proofOfAddress.push(person);
      } else {
        S.extractedPersons.push(person);
      }

      var t3 = Date.now();
      addLog(typeName + ' EXTRACTED (' + (t3 - t2) + 'ms)');
      renderResults();

    } catch (err) {
      addLog('ERROR: ' + err.message);
    }
  }

  /* ── RENDER ── */
  function renderResults() {
    var el = $('olp-results');
    if (S.extractedPersons.length === 0 && S.proofOfAddress.length === 0) {
      el.innerHTML = '<div style="color:#888;padding:8px;">No data extracted yet</div>';
      return;
    }

    var html = '';
    S.extractedPersons.forEach(function(p, i) {
      var fullName = [p.title, p.firstNames, p.surname].filter(Boolean).join(' ');
      html += '<div class="olp-card">' +
        '<div class="olp-card-title">Person ' + (i + 1) + ' — ' + (DOCTYPE_NAMES[p.documentType] || 'ID') + '</div>' +
        '<table class="olp-table">' +
        '<tr><td class="olp-label">Name</td><td><strong>' + (fullName || '-') + '</strong></td></tr>' +
        '<tr><td class="olp-label">Surname</td><td>' + (p.surname || '-') + '</td></tr>' +
        '<tr><td class="olp-label">First Names</td><td>' + (p.firstNames || '-') + '</td></tr>' +
        '<tr><td class="olp-label">DOB</td><td>' + (p.dob || '-') + '</td></tr>' +
        '<tr><td class="olp-label">Address</td><td>' + (p.address || '-') + '</td></tr>' +
        '<tr><td class="olp-label">Postcode</td><td style="font-weight:600;">' + (p.postcode || '-') + '</td></tr>' +
        '<tr><td class="olp-label">Doc No.</td><td style="font-family:monospace;font-size:11px;">' + (p.documentNumber || '-') + '</td></tr>' +
        '</table></div>';
    });

    S.proofOfAddress.forEach(function(p) {
      html += '<div class="olp-card">' +
        '<div class="olp-card-title">Proof of Address — ' + (p.documentType || 'Document') + '</div>' +
        '<table class="olp-table">' +
        '<tr><td class="olp-label">Name</td><td>' + (p.fullName || '-') + '</td></tr>' +
        '<tr><td class="olp-label">Address</td><td>' + (p.address || '-') + '</td></tr>' +
        '<tr><td class="olp-label">Postcode</td><td style="font-weight:600;">' + (p.postcode || '-') + '</td></tr>' +
        '</table></div>';
    });

    // Postcode cross-check across all documents
    var allPostcodes = [];
    S.extractedPersons.forEach(function(p) {
      if (p.postcode && p.postcode !== '[unclear]') allPostcodes.push({ source: (DOCTYPE_NAMES[p.documentType] || 'ID') + ' (' + [p.title, p.firstNames, p.surname].filter(Boolean).join(' ') + ')', postcode: p.postcode.toUpperCase().replace(/\s+/g, ' ').trim() });
    });
    S.proofOfAddress.forEach(function(p) {
      if (p.postcode && p.postcode !== '[unclear]') allPostcodes.push({ source: (p.documentType || 'Proof of Address'), postcode: p.postcode.toUpperCase().replace(/\s+/g, ' ').trim() });
    });

    if (allPostcodes.length > 1) {
      var uniquePostcodes = {};
      allPostcodes.forEach(function(pc) { uniquePostcodes[pc.postcode] = (uniquePostcodes[pc.postcode] || []).concat(pc.source); });
      var postcodeKeys = Object.keys(uniquePostcodes);
      if (postcodeKeys.length === 1) {
        html += '<div class="olp-card" style="border-color:#4ade8055;"><div class="olp-card-title" style="color:#4ade80;">&#10003; Postcode Match</div><div style="font-size:11px;">All documents show: <strong>' + postcodeKeys[0] + '</strong></div></div>';
      } else {
        html += '<div class="olp-card" style="border-color:#f8717155;"><div class="olp-card-title" style="color:#f87171;">&#10007; Postcode Mismatch</div>';
        postcodeKeys.forEach(function(pc) {
          html += '<div style="font-size:11px;padding:2px 0;"><strong>' + pc + '</strong> — ' + uniquePostcodes[pc].join(', ') + '</div>';
        });
        html += '</div>';
      }
    }

    el.innerHTML = html;
  }

  /* ── PDF UPLOAD ── */
  function initPdfWorker() {
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
    }
  }

  async function handlePdfUpload(file) {
    if (S.wills.length >= 2) {
      addLog('Already have 2 wills. Remove one first.');
      return;
    }
    addLog('Loading PDF: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + 'KB)');

    try {
      initPdfWorker();

      // Read file as ArrayBuffer
      var arrayBuffer = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = function() { reject(new Error('Failed to read file')); };
        reader.readAsArrayBuffer(file);
      });

      // Extract text from all pages
      var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      var allText = '';
      addLog('PDF has ' + pdf.numPages + ' page(s), extracting text...');

      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        var pageText = content.items.map(function(item) { return item.str; }).join(' ');
        allText += pageText + '\n';
      }

      allText = allText.trim();
      if (!allText || allText.length < 10) {
        addLog('WARNING: PDF has very little text (' + allText.length + ' chars). May be scanned image — try pasting text instead.');
        return;
      }

      // Create a blob URL for the original PDF so we can display it natively
      var pdfBlobUrl = URL.createObjectURL(file);

      // Add to wills array
      S.wills.push({ name: file.name, text: allText, blobUrl: pdfBlobUrl });
      addLog('Will ' + S.wills.length + ' loaded: ' + file.name + ' (' + allText.length + ' chars, ' + pdf.numPages + ' pages)');

      renderWills();
      $('olp-verify').style.display = 'inline-block';

      // Hide drop zone if we have 2
      if (S.wills.length >= 2) {
        $('olp-pdf-drop').style.display = 'none';
      }

      // Auto-verify
      if (S.extractedPersons.length > 0) runVerification();

    } catch (err) {
      addLog('ERROR: PDF failed: ' + err.message);
    }
  }

  function renderWills() {
    var container = $('olp-wills-container');
    if (S.wills.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = S.wills.map(function(w, i) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#4ade8015;border:1px solid #4ade8033;border-radius:6px;margin-bottom:4px;">' +
        '<div><span style="color:#4ade80;">&#10003;</span> <strong style="font-size:11px;">Will ' + (i + 1) + ':</strong> <span style="font-size:11px;color:#aaa;">' + w.name + ' (' + w.text.length + ' chars)</span></div>' +
        '<button class="olp-btn-sm olp-remove-will" data-willindex="' + i + '" style="font-size:10px;width:18px;height:18px;line-height:16px;">X</button></div>';
    }).join('');
    container.querySelectorAll('.olp-remove-will').forEach(function(btn) {
      btn.onclick = function() {
        var idx = parseInt(btn.dataset.willindex);
        if (S.wills[idx] && S.wills[idx].blobUrl) URL.revokeObjectURL(S.wills[idx].blobUrl);
        S.wills.splice(idx, 1);
        renderWills();
        $('olp-pdf-drop').style.display = 'block';
        if (S.extractedPersons.length > 0 && S.wills.length > 0) runVerification();
        else $('olp-verify-results').innerHTML = '<div style="color:#888;padding:8px;">Upload will(s) first</div>';
      };
    });
  }

  /* ── WILL VERIFICATION ── */
  function saveWillText() {
    var textarea = $('olp-will-text');
    var text = textarea.value.trim();
    if (!text) return;
    if (S.wills.length >= 2) { addLog('Already have 2 wills. Remove one first.'); return; }
    S.wills.push({ name: 'Pasted text', text: text });
    textarea.value = '';
    addLog('Pasted will text added (' + text.length + ' chars)');
    renderWills();
    if (S.wills.length >= 2) $('olp-pdf-drop').style.display = 'none';
    $('olp-verify').style.display = 'inline-block';
    if (S.extractedPersons.length > 0) runVerification();
  }

  function runVerification() {
    if (S.wills.length === 0 || S.extractedPersons.length === 0) return;
    var el = $('olp-verification');
    var allHtml = '';

    // Check every person against every will
    var matches = [];
    S.extractedPersons.forEach(function(person) {
      S.wills.forEach(function(w) {
        matches.push({ person: person, will: w });
      });
    });

    // Titles to exclude from name checks
    var TITLES = ['MR', 'MRS', 'MISS', 'MS', 'DR', 'PROF', 'REV', 'SIR', 'LADY', 'LORD', 'MASTER', 'MX'];

    var totalPass = 0, totalFail = 0, totalWarn = 0;

    matches.forEach(function(match) {
      var person = match.person;
      var willText = match.will.text;
      var willUpper = willText.toUpperCase();
      var willName = match.will.name;
      var results = [];
      var surname = (person.surname || '').toUpperCase().trim();
      var firstNames = (person.firstNames || '').toUpperCase().trim();
      var personLabel = [person.title, person.firstNames, person.surname].filter(Boolean).join(' ');

      if (surname) {
        var count = countOcc(willUpper, surname);
        if (count > 0) results.push({ s: 'pass', t: 'Surname "' + person.surname + '"', d: count + ' found' });
        else {
          results.push({ s: 'fail', t: 'Surname "' + person.surname + '"', d: 'NOT FOUND' });
          var sim = findSimilar(surname, willUpper);
          if (sim.length) results.push({ s: 'warn', t: 'Similar to "' + person.surname + '"', d: sim.join(', ') });
        }
      }
      if (firstNames) {
        firstNames.split(/\s+/).forEach(function(name) {
          if (name.length < 2) return;
          // Skip titles — these aren't real names
          if (TITLES.indexOf(name) !== -1) return;
          var count = countOcc(willUpper, name);
          if (count > 0) results.push({ s: 'pass', t: 'Name "' + name + '"', d: count + ' found' });
          else results.push({ s: 'fail', t: 'Name "' + name + '"', d: 'NOT FOUND in will' });
        });
      }
      if (person.address) {
        // Extract meaningful address words (street names, town, county, etc.)
        // Skip very short/common words and numbers-only tokens
        var addrWords = person.address.toUpperCase().replace(/[,.\n]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; });
        var SKIP_WORDS = ['THE', 'AND', 'FLAT', 'FLOOR'];
        var matched = 0, total = 0, missing = [];
        addrWords.forEach(function(word) {
          if (SKIP_WORDS.indexOf(word) !== -1) return;
          total++;
          if (willUpper.indexOf(word) !== -1) matched++;
          else missing.push(word);
        });
        if (total === 0) { /* skip */ }
        else if (matched === total) results.push({ s: 'pass', t: 'Address', d: 'All ' + total + ' words found' });
        else if (matched / total >= 0.7) results.push({ s: 'pass', t: 'Address', d: matched + '/' + total + ' words found' + (missing.length ? '. Check: ' + missing.join(', ') : '') });
        else if (matched > 0) results.push({ s: 'warn', t: 'Address partial', d: matched + '/' + total + ' words. Missing: ' + missing.join(', ') });
        else results.push({ s: 'fail', t: 'Address', d: 'NOT FOUND' });
      }

      var pass = results.filter(function(r) { return r.s === 'pass'; }).length;
      var fail = results.filter(function(r) { return r.s === 'fail'; }).length;
      var warn = results.filter(function(r) { return r.s === 'warn'; }).length;
      totalPass += pass; totalFail += fail; totalWarn += warn;

      var sc = fail > 0 ? '#f87171' : warn > 0 ? '#fbbf24' : '#4ade80';
      allHtml += '<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:#6366f1;margin-bottom:4px;">' + personLabel + ' &#8594; ' + willName + '</div>';
      allHtml += '<div style="padding:4px 8px;background:' + sc + '22;border-left:3px solid ' + sc + ';border-radius:4px;margin-bottom:4px;font-size:11px;">' +
        '<strong>' + (fail > 0 ? fail + ' issue(s)' : warn > 0 ? warn + ' warning(s)' : 'All passed') + '</strong></div>';
      allHtml += results.map(function(r) {
        var icon = r.s === 'pass' ? '&#10003;' : r.s === 'fail' ? '&#10007;' : '!';
        var color = r.s === 'pass' ? '#4ade80' : r.s === 'fail' ? '#f87171' : '#fbbf24';
        return '<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid #222;font-size:11px;">' +
          '<span style="color:' + color + ';font-weight:bold;width:16px;text-align:center;">' + icon + '</span>' +
          '<span style="flex:1;">' + r.t + '</span><span style="color:#888;">' + r.d + '</span></div>';
      }).join('');
      allHtml += '</div>';
    });

    // Check proof vs ID address
    if (S.proofOfAddress.length > 0 && S.extractedPersons.length > 0) {
      var pAddr = (S.proofOfAddress[0].address || '').toUpperCase().replace(/\s+/g, ' ');
      var iAddr = (S.extractedPersons[0].address || '').toUpperCase().replace(/\s+/g, ' ');
      if (pAddr && iAddr) {
        var addrMatch = pAddr === iAddr;
        var sc2 = addrMatch ? '#4ade80' : '#fbbf24';
        allHtml += '<div style="padding:4px 8px;background:' + sc2 + '22;border-left:3px solid ' + sc2 + ';border-radius:4px;font-size:11px;">' +
          (addrMatch ? '&#10003; ID & Proof of Address match' : '! ID & Proof of Address differ — check manually') + '</div>';
        if (addrMatch) totalPass++; else totalWarn++;
      }
    }

    // Overall summary at top
    var overallColor = totalFail > 0 ? '#f87171' : totalWarn > 0 ? '#fbbf24' : '#4ade80';
    var overallText = totalFail > 0 ? totalFail + ' issue(s) found' : totalWarn > 0 ? totalWarn + ' warning(s)' : 'All checks passed';
    el.innerHTML = '<div style="padding:8px;background:' + overallColor + '22;border-left:3px solid ' + overallColor + ';border-radius:4px;margin-bottom:10px;">' +
      '<strong>' + overallText + '</strong> — ' + totalPass + ' pass, ' + totalWarn + ' warn, ' + totalFail + ' fail</div>' + allHtml;

    addLog('Verification: ' + totalPass + ' pass, ' + totalWarn + ' warn, ' + totalFail + ' fail');

    // Run deep consistency check on each will via Claude API
    if (S.apiKey) {
      allHtml += '<div id="olp-consistency" style="margin-top:10px;"><div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;">Deep Consistency Check</div><div class="olp-spinner" style="margin:8px auto;"></div><div style="font-size:11px;color:#888;text-align:center;">Analysing will text...</div></div>';
      el.innerHTML = '<div style="padding:8px;background:' + overallColor + '22;border-left:3px solid ' + overallColor + ';border-radius:4px;margin-bottom:10px;">' +
        '<strong>' + overallText + '</strong> — ' + totalPass + ' pass, ' + totalWarn + ' warn, ' + totalFail + ' fail</div>' + allHtml;
      runConsistencyChecks();
    } else {
      el.innerHTML = '<div style="padding:8px;background:' + overallColor + '22;border-left:3px solid ' + overallColor + ';border-radius:4px;margin-bottom:10px;">' +
        '<strong>' + overallText + '</strong> — ' + totalPass + ' pass, ' + totalWarn + ' warn, ' + totalFail + ' fail</div>' + allHtml;
    }
  }

  async function runConsistencyChecks() {
    var consistencyEl = $('olp-consistency');
    if (!consistencyEl) return;

    var allResults = [];

    for (var i = 0; i < S.wills.length; i++) {
      var will = S.wills[i];
      addLog('Consistency check: ' + will.name + '...');

      // Build context of known persons for the prompt
      var personsContext = S.extractedPersons.map(function(p) {
        return [p.title, p.firstNames, p.surname].filter(Boolean).join(' ') +
          (p.address ? ', Address: ' + p.address : '') +
          (p.postcode ? ', Postcode: ' + p.postcode : '') +
          (p.dob ? ', DOB: ' + p.dob : '');
      }).join('\n');

      var proofContext = S.proofOfAddress.map(function(p) {
        return (p.fullName || '') + (p.address ? ', Address: ' + p.address : '') + (p.postcode ? ', Postcode: ' + p.postcode : '');
      }).join('\n');

      var prompt = 'You are a UK will proofreading assistant. Analyse this will for internal consistency.\n\n' +
        'KNOWN PERSONS FROM ID DOCUMENTS:\n' + personsContext + '\n\n' +
        (proofContext ? 'PROOF OF ADDRESS:\n' + proofContext + '\n\n' : '') +
        'WILL TEXT:\n' + will.text.substring(0, 12000) + '\n\n' +
        'Check for:\n' +
        '1. NAMES: Is the testator\'s full name spelled consistently throughout? Are any named people (executors, guardians, beneficiaries, trustees) spelled differently in different places?\n' +
        '2. ADDRESSES: Are all addresses complete and consistent each time they appear? Does the testator\'s address match their ID?\n' +
        '3. RELATIONS: Are relationships (e.g. "my wife", "my son") consistent with the names used? Are the same people referred to with consistent relationships?\n' +
        '4. ROLES: Are executor/guardian/trustee appointments consistent (not contradicted elsewhere)?\n\n' +
        'Return ONLY a JSON array of findings. Each finding: {"status":"pass"|"warn"|"fail","category":"names"|"addresses"|"relations"|"roles","detail":"short description"}.\n' +
        'If everything is consistent, return [{"status":"pass","category":"overall","detail":"All names, addresses, relations and roles are consistent throughout"}].\n' +
        'Be specific about any inconsistencies found. Do NOT hallucinate issues — only flag genuine inconsistencies you can see in the text.';

      try {
        var apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': S.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (!apiResp.ok) {
          addLog('ERROR: Consistency check API ' + apiResp.status);
          continue;
        }

        var result = await apiResp.json();
        var responseText = (result.content && result.content[0] && result.content[0].text) || '';
        var jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          var findings = JSON.parse(jsonMatch[0]);
          allResults.push({ willName: will.name, findings: findings });
        }
      } catch (err) {
        addLog('ERROR: Consistency check failed: ' + err.message);
      }
    }

    // Cross-will comparison for couples
    if (S.wills.length === 2) {
      addLog('Cross-will comparison...');
      var crossPrompt = 'You are a UK will proofreading assistant. These are two wills for a couple. Compare them for cross-will consistency.\n\n' +
        'KNOWN PERSONS FROM ID DOCUMENTS:\n' + S.extractedPersons.map(function(p) {
          return [p.title, p.firstNames, p.surname].filter(Boolean).join(' ') +
            (p.address ? ', Address: ' + p.address : '') +
            (p.postcode ? ', Postcode: ' + p.postcode : '');
        }).join('\n') + '\n\n' +
        'WILL 1 (' + S.wills[0].name + '):\n' + S.wills[0].text.substring(0, 6000) + '\n\n' +
        'WILL 2 (' + S.wills[1].name + '):\n' + S.wills[1].text.substring(0, 6000) + '\n\n' +
        'Check for cross-will consistency:\n' +
        '1. NAMES: Are executors, guardians, trustees, and beneficiaries spelled the same way in both wills? Flag any name that appears differently between the two wills.\n' +
        '2. ADDRESSES: Are the same addresses written consistently across both wills?\n' +
        '3. RELATIONS: Are relationships described consistently? e.g. if Will 1 says "my wife JANE" does Will 2 say "my husband JOHN" (and vice versa)? Are children named consistently?\n' +
        '4. ROLES: Are the same people appointed to the same roles in both wills? e.g. same executors, same guardians, same trustees? Flag any differences.\n' +
        '5. PROVISIONS: Are legacies, gifts, residuary estate splits, and trust provisions consistent between the two wills where you\'d expect them to be?\n\n' +
        'Return ONLY a JSON array of findings. Each finding: {"status":"pass"|"warn"|"fail","category":"names"|"addresses"|"relations"|"roles"|"provisions","detail":"short description comparing both wills"}.\n' +
        'Be specific about any differences. Do NOT hallucinate issues — only flag genuine differences you can see in the text.';

      try {
        var crossResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': S.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{ role: 'user', content: crossPrompt }]
          })
        });

        if (crossResp.ok) {
          var crossResult = await crossResp.json();
          var crossText = (crossResult.content && crossResult.content[0] && crossResult.content[0].text) || '';
          var crossJson = crossText.match(/\[[\s\S]*\]/);
          if (crossJson) {
            var crossFindings = JSON.parse(crossJson[0]);
            allResults.push({ willName: 'Cross-Will Comparison (' + S.wills[0].name + ' vs ' + S.wills[1].name + ')', findings: crossFindings });
          }
        } else {
          addLog('ERROR: Cross-will check API ' + crossResp.status);
        }
      } catch (err) {
        addLog('ERROR: Cross-will check failed: ' + err.message);
      }
    }

    // Render consistency results
    var html = '<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;">Deep Consistency Check</div>';

    allResults.forEach(function(r) {
      html += '<div style="margin-bottom:8px;"><div style="font-size:11px;font-weight:600;color:#6366f1;margin-bottom:4px;">' + r.willName + '</div>';
      r.findings.forEach(function(f) {
        var icon, color;
        if (f.status === 'pass') { icon = '&#10003;'; color = '#4ade80'; }
        else if (f.status === 'fail') { icon = '&#10007;'; color = '#f87171'; }
        else { icon = '!'; color = '#fbbf24'; }
        var catLabel = f.category ? '<span style="color:#6366f1;font-weight:600;text-transform:uppercase;margin-right:4px;">' + f.category + '</span>' : '';
        html += '<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid #222;font-size:11px;">' +
          '<span style="color:' + color + ';font-weight:bold;width:16px;text-align:center;flex-shrink:0;">' + icon + '</span>' +
          '<span style="flex:1;">' + catLabel + (f.detail || '') + '</span></div>';
      });
      html += '</div>';
    });

    if (allResults.length === 0) {
      html += '<div style="color:#888;font-size:11px;">Could not run consistency check</div>';
    }

    consistencyEl.innerHTML = html;
    addLog('Consistency check complete');
  }

  /* ── HELPERS ── */
  function countOcc(text, search) {
    var e = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text.match(new RegExp(e, 'g')) || []).length;
  }
  function findSimilar(target, text) {
    var words = [], seen = {};
    (text.match(/[A-Z]{3,}/g) || []).forEach(function(w) { if (!seen[w]) { seen[w] = true; words.push(w); } });
    return words.filter(function(w) { return w !== target && Math.abs(w.length - target.length) <= 2 && lev(target, w) <= 2 && lev(target, w) > 0; }).slice(0, 5);
  }
  function lev(a, b) {
    var m = a.length, n = b.length, dp = [];
    for (var i = 0; i <= m; i++) { dp[i] = []; for (var j = 0; j <= n; j++) dp[i][j] = 0; }
    for (var i = 0; i <= m; i++) dp[i][0] = i;
    for (var j = 0; j <= n; j++) dp[0][j] = j;
    for (var i = 1; i <= m; i++) for (var j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
  }
  function addLog(msg) {
    var log = $('olp-log');
    var time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    log.textContent += '[' + time + '] ' + msg + '\n';
    log.scrollTop = log.scrollHeight;
  }

  /* ── HTML ── */
  function buildHTML() {
    return '<div id="olp-header">' +
      '<span style="font-weight:700;">&#128270; Will Proofreader</span>' +
      '<span>' +
        '<button id="olp-settings-toggle" class="olp-btn-sm" title="Settings">&#9881;</button> ' +
        '<button id="olp-minimize" class="olp-btn-sm">_</button> ' +
        '<button id="olp-close" class="olp-btn-sm">X</button>' +
      '</span></div>' +
      '<div id="olp-body">' +
        // Settings (hidden by default once key is saved)
        '<div id="olp-settings" style="display:none;margin-bottom:8px;padding:8px;background:#1a1a2e;border:1px solid #333;border-radius:6px;">' +
          '<label style="font-size:11px;color:#aaa;">Team API Key</label>' +
          '<div style="display:flex;gap:4px;">' +
            '<input id="olp-key-input" type="password" placeholder="sk-ant-..." style="flex:1;padding:4px 6px;background:#0a0a1a;border:1px solid #444;border-radius:4px;color:#fff;font-size:11px;">' +
            '<button id="olp-save-key" class="olp-btn">Save</button>' +
          '</div>' +
          '<div id="olp-key-status" style="font-size:11px;margin-top:2px;"></div>' +
          '<button id="olp-extract" class="olp-btn" style="width:100%;margin-top:6px;">&#9889; Re-extract Documents</button>' +
        '</div>' +
        // Hidden log for debugging
        '<pre id="olp-log" style="display:none;"></pre>' +
        // Loading indicator
        '<div id="olp-loading" style="display:none;padding:8px;text-align:center;"><div class="olp-spinner"></div><div id="olp-loading-text" style="font-size:11px;color:#888;margin-top:4px;">Extracting documents...</div></div>' +
        // Extracted Data
        '<div class="olp-section"><div class="olp-section-title">Extracted Data</div><div id="olp-results"><div style="color:#888;padding:8px;font-size:11px;">Loading...</div></div></div>' +
        // Will Documents
        '<div class="olp-section"><div class="olp-section-title">Will Documents <span style="font-weight:400;color:#666;">(up to 2 for couples)</span></div>' +
          '<div id="olp-wills-container"></div>' +
          '<div id="olp-pdf-drop" style="border:2px dashed #444;border-radius:8px;padding:12px;text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:6px;">' +
            '<div style="font-size:18px;margin-bottom:2px;">&#128196;</div>' +
            '<div style="color:#aaa;font-size:11px;">Drop will PDF or <span style="color:#6366f1;text-decoration:underline;">click to upload</span></div>' +
            '<input id="olp-pdf-input" type="file" accept=".pdf" style="display:none;">' +
          '</div>' +
          '<details style="margin-bottom:4px;"><summary style="font-size:11px;color:#666;cursor:pointer;">Or paste text</summary>' +
            '<textarea id="olp-will-text" placeholder="Paste will text..." style="width:100%;height:50px;background:#1a1a2e;border:1px solid #444;border-radius:4px;padding:6px;color:#fff;font-size:11px;font-family:inherit;resize:vertical;margin-top:4px;"></textarea>' +
            '<button id="olp-save-will" class="olp-btn" style="margin-top:4px;">Add Text & Verify</button>' +
          '</details>' +
          '<button id="olp-verify" class="olp-btn" style="display:none;margin-top:4px;">Re-verify</button>' +
        '</div>' +
        // Verification
        '<div class="olp-section"><div class="olp-section-title">Verification</div><div id="olp-verification"><div style="color:#888;padding:8px;font-size:11px;">Upload will PDF(s) above to verify</div></div></div>' +
        // Split View button
        '<div class="olp-section">' +
          '<button id="olp-split-view" class="olp-btn" style="width:100%;background:#1a1a3e;border:1px solid #444;">&#128195; Open Split View (Will + Instruction Form)</button>' +
        '</div>' +
      '</div>';
  }

  /* ── STYLES ── */
  function addStyles() {
    var style = document.createElement('style');
    style.textContent = '#olWillProofreader{position:fixed;top:10px;right:10px;width:340px;max-height:calc(100vh - 20px);background:#12122b;border:1px solid #333;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:999999;font-family:-apple-system,system-ui,sans-serif;font-size:12px;color:#e0e0e0;overflow-y:auto;}' +
      '#olp-header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #333;background:#1a1a3e;border-radius:10px 10px 0 0;cursor:move;}' +
      '#olp-body{padding:8px;}' +
      '.olp-section{margin-bottom:8px;}' +
      '.olp-section-title{font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;}' +
      '.olp-btn{padding:4px 10px;background:#6366f1;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;}' +
      '.olp-btn:hover{background:#4f46e5;}' +
      '.olp-btn-sm{background:transparent;border:1px solid #555;color:#aaa;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:11px;}' +
      '.olp-btn-sm:hover{background:#333;}' +
      '.olp-card{background:#1a1a2e;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:6px;}' +
      '.olp-card-title{font-size:11px;font-weight:600;color:#6366f1;margin-bottom:4px;}' +
      '.olp-table{width:100%;border-collapse:collapse;}' +
      '.olp-table td{padding:2px 4px;font-size:11px;border-bottom:1px solid #222;}' +
      '.olp-label{color:#888;width:80px;}' +
      '@keyframes olp-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}' +
      '.olp-spinner{width:24px;height:24px;border:3px solid #333;border-top:3px solid #6366f1;border-radius:50%;animation:olp-spin 0.8s linear infinite;margin:0 auto;}';
    document.head.appendChild(style);
  }

  /* ── FIND AND CLICK "VIEW PDF" IN AN IFRAME ── */
  function autoClickViewPdf(iframeDoc) {
    // Find buttons/links whose text contains "view pdf", excluding ID attachment contexts
    var links = iframeDoc.querySelectorAll('a, button');
    for (var i = 0; i < links.length; i++) {
      var text = (links[i].textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (text.match(/view\s*pdf/i)) {
        var parentText = (links[i].closest('div, section, li, tr') || {}).textContent || '';
        var parentLower = parentText.toLowerCase();
        var isAttachment = parentLower.match(/driving|licence|license|passport|council\s*tax|bank\s*statement|utility|proof\s*of\s*(id|address)/i);
        if (!isAttachment) {
          links[i].click();
          return true;
        }
      }
    }
    return false;
  }

  /* ── SPLIT VIEW ── */
  function openSplitView() {
    if (S.wills.length === 0) {
      addLog('Upload a will PDF first');
      return;
    }

    var existing = document.getElementById('olp-split-overlay');
    if (existing) existing.remove();

    // Keep panel visible on the right — fit split view to the left of it
    var panelWidth = panel.offsetWidth || 340;
    var panelRight = 10; // matches the CSS right:10px
    var reservedWidth = panelWidth + panelRight + 10; // panel + gap

    var overlay = document.createElement('div');
    overlay.id = 'olp-split-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:calc(100vw - ' + reservedWidth + 'px);height:100vh;background:#0a0a1a;z-index:9999998;display:flex;flex-direction:column;';

    // Top bar
    var topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#1a1a3e;border-bottom:1px solid #333;flex-shrink:0;';
    topBar.innerHTML = '<span style="color:#e0e0e0;font-weight:700;font-size:14px;">&#128195; Split View — Will + Instruction Form</span>' +
      '<button id="olp-split-close" style="padding:6px 16px;background:#f87171;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Close Split View</button>';
    overlay.appendChild(topBar);

    // Split panes container
    var panes = document.createElement('div');
    panes.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    // Left pane: Will PDF (50%)
    var leftPane = document.createElement('div');
    leftPane.style.cssText = 'width:50%;display:flex;flex-direction:column;border-right:2px solid #333;overflow:hidden;';

    // Will selector tabs if 2 wills
    var pdfEmbed;
    var willTextFallback;

    if (S.wills.length > 1) {
      var willTabs = document.createElement('div');
      willTabs.style.cssText = 'display:flex;background:#12122b;border-bottom:1px solid #333;flex-shrink:0;';
      S.wills.forEach(function(w, i) {
        var tab = document.createElement('button');
        tab.textContent = 'Will ' + (i + 1) + ': ' + w.name;
        tab.style.cssText = 'flex:1;padding:8px;background:' + (i === 0 ? '#1a1a3e' : 'transparent') + ';color:#e0e0e0;border:none;border-bottom:2px solid ' + (i === 0 ? '#6366f1' : 'transparent') + ';cursor:pointer;font-size:12px;';
        tab.onclick = function() {
          willTabs.querySelectorAll('button').forEach(function(b, j) {
            b.style.background = j === i ? '#1a1a3e' : 'transparent';
            b.style.borderBottom = '2px solid ' + (j === i ? '#6366f1' : 'transparent');
          });
          showWillInPane(S.wills[i], pdfEmbed, willTextFallback);
        };
        willTabs.appendChild(tab);
      });
      leftPane.appendChild(willTabs);
    }

    // PDF embed (shown when will has blobUrl)
    pdfEmbed = document.createElement('iframe');
    pdfEmbed.style.cssText = 'flex:1;width:100%;border:none;background:#fff;';

    // Text fallback (shown when will is pasted text only)
    willTextFallback = document.createElement('pre');
    willTextFallback.style.cssText = 'flex:1;overflow-y:auto;padding:16px;margin:0;font-size:12px;line-height:1.6;color:#e0e0e0;white-space:pre-wrap;word-wrap:break-word;font-family:-apple-system,system-ui,sans-serif;background:#0f0f1a;display:none;';

    leftPane.appendChild(pdfEmbed);
    leftPane.appendChild(willTextFallback);

    // Show first will
    showWillInPane(S.wills[0], pdfEmbed, willTextFallback);

    // Right pane: Instruction form (50%)
    var rightPane = document.createElement('div');
    rightPane.style.cssText = 'width:50%;display:flex;flex-direction:column;overflow:hidden;';

    var rightHeader = document.createElement('div');
    rightHeader.style.cssText = 'padding:6px 12px;background:#12122b;font-size:12px;font-weight:600;color:#6366f1;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;';
    var rightHeaderLabel = document.createElement('span');
    rightHeaderLabel.textContent = 'Instruction Form (Inkwell)';
    var rightBackBtn = document.createElement('button');
    rightBackBtn.style.cssText = 'display:none;padding:3px 10px;background:#6366f1;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;';
    rightBackBtn.innerHTML = '&#8592; Back to page';
    rightHeader.appendChild(rightHeaderLabel);
    rightHeader.appendChild(rightBackBtn);
    rightPane.appendChild(rightHeader);

    // Page navigation tabs for instruction form PDF sections
    var FORM_SECTIONS = [
      { label: 'Executors', page: 11 },
      { label: 'Guardians', page: 14 },
      { label: 'Legacies', page: 16 },
      { label: 'Residuary Estate', page: 20 },
      { label: 'Funeral Wishes', page: 35 },
      { label: 'Trusts', page: 27 }
    ];

    var pdfNavBar = document.createElement('div');
    pdfNavBar.id = 'olp-pdf-nav';
    pdfNavBar.style.cssText = 'display:none;padding:4px 8px;background:#1a1a2e;border-bottom:1px solid #333;flex-shrink:0;overflow-x:auto;white-space:nowrap;';
    var currentPdfBaseUrl = '';

    FORM_SECTIONS.forEach(function(section) {
      var btn = document.createElement('button');
      btn.textContent = section.label;
      btn.title = 'Page ' + section.page;
      btn.style.cssText = 'padding:4px 10px;margin-right:4px;background:#2a2a4e;color:#e0e0e0;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;white-space:nowrap;';
      btn.onmouseenter = function() { btn.style.background = '#6366f1'; btn.style.borderColor = '#6366f1'; };
      btn.onmouseleave = function() { btn.style.background = '#2a2a4e'; btn.style.borderColor = '#444'; };
      btn.onclick = function() {
        if (currentPdfBaseUrl) {
          var sep = currentPdfBaseUrl.indexOf('?') !== -1 ? '&' : '?';
          inkwellIframe.src = currentPdfBaseUrl + sep + '_t=' + Date.now() + '#page=' + section.page;
        }
      };
      pdfNavBar.appendChild(btn);
    });
    rightPane.appendChild(pdfNavBar);

    var inkwellIframe = document.createElement('iframe');
    inkwellIframe.style.cssText = 'flex:1;width:100%;border:none;background:#fff;';

    var originalSrc = window.location.href;
    inkwellIframe.src = window.location.href;
    rightPane.appendChild(inkwellIframe);

    var hasAutoClicked = false;
    function interceptPdfClicks() {
      try {
        var iframeDoc = inkwellIframe.contentDocument || inkwellIframe.contentWindow.document;
        if (!iframeDoc) return;

        // Check if the loaded page has an embedded PDF (e.g. embed/object/iframe with PDF)
        var pdfEmbeds = iframeDoc.querySelectorAll('embed[type="application/pdf"], embed[src*=".pdf"], object[data*=".pdf"], iframe[src*=".pdf"], iframe[src*="supabase.co/storage"]');
        if (pdfEmbeds.length > 0) {
          var pdfSrc = pdfEmbeds[0].src || pdfEmbeds[0].data;
          if (pdfSrc) {
            currentPdfBaseUrl = pdfSrc.split('#')[0];
            inkwellIframe.src = pdfSrc;
            rightHeaderLabel.textContent = 'Instruction Form PDF';
            rightBackBtn.style.display = 'inline-block';
            pdfNavBar.style.display = 'block';
            return;
          }
        }

        // Intercept clicks on links/buttons that look like PDF viewers
        iframeDoc.addEventListener('click', function(e) {
          var link = e.target.closest('a, button');
          if (!link) return;
          var href = link.href || link.getAttribute('href') || '';
          var text = (link.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          // Match links/buttons containing "View PDF", excluding ID attachment links
          var parentText = (link.closest('div, section, li, tr') || {}).textContent || '';
          var isAttachment = parentText.toLowerCase().match(/driving|licence|license|passport|council\s*tax|bank\s*statement|utility|proof\s*of\s*(id|address)/i);
          if (text.match(/view\s*pdf/i) && !isAttachment) {
            if (href && href.startsWith('http')) {
              e.preventDefault();
              e.stopPropagation();
              currentPdfBaseUrl = href.split('#')[0];
              inkwellIframe.src = href;
              rightHeaderLabel.textContent = 'Instruction Form PDF';
              rightBackBtn.style.display = 'inline-block';
              pdfNavBar.style.display = 'block';
            }
          }
        }, true);

        // Auto-click the "View PDF" button as soon as it appears
        if (!hasAutoClicked) {
          hasAutoClicked = true;
          var pollAttempts = 0;
          var pollInterval = setInterval(function() {
            pollAttempts++;
            try {
              var iDoc = inkwellIframe.contentDocument || inkwellIframe.contentWindow.document;
              if (iDoc && autoClickViewPdf(iDoc)) {
                clearInterval(pollInterval);
              } else if (pollAttempts > 30) {
                clearInterval(pollInterval); // Give up after 6 seconds
              }
            } catch(e) { clearInterval(pollInterval); }
          }, 200);
        }

        // Also watch for dynamically added PDF embeds via MutationObserver
        var observer = new MutationObserver(function() {
          var embeds = iframeDoc.querySelectorAll('embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], iframe[src*="supabase.co/storage"]');
          if (embeds.length > 0) {
            var src = embeds[0].src || embeds[0].data;
            if (src) {
              currentPdfBaseUrl = src.split('#')[0];
              inkwellIframe.src = src;
              rightHeaderLabel.textContent = 'Instruction Form PDF';
              rightBackBtn.style.display = 'inline-block';
              pdfNavBar.style.display = 'block';
              observer.disconnect();
            }
          }
        });
        observer.observe(iframeDoc.body, { childList: true, subtree: true });
      } catch(e) { /* cross-origin or not ready yet */ }
    }

    inkwellIframe.addEventListener('load', interceptPdfClicks);

    // Back button to return to the full Inkwell page
    panes.appendChild(leftPane);
    panes.appendChild(rightPane);
    overlay.appendChild(panes);
    document.body.appendChild(overlay);

    rightBackBtn.onclick = function() {
      inkwellIframe.src = originalSrc;
      rightHeaderLabel.textContent = 'Instruction Form (Inkwell)';
      rightBackBtn.style.display = 'none';
      pdfNavBar.style.display = 'none';
      currentPdfBaseUrl = '';
    };

    document.getElementById('olp-split-close').onclick = function() {
      overlay.remove();
    };
  }

  function showWillInPane(will, pdfEmbed, textFallback) {
    if (will.blobUrl) {
      // Show the actual PDF
      pdfEmbed.src = will.blobUrl;
      pdfEmbed.style.display = 'block';
      textFallback.style.display = 'none';
    } else {
      // Pasted text fallback
      pdfEmbed.style.display = 'none';
      textFallback.style.display = 'block';
      textFallback.textContent = will.text;
    }
  }

  /* ── MAKE DRAGGABLE ── */
  var header = $('olp-header');
  var isDragging = false, dragX, dragY;
  header.addEventListener('mousedown', function(e) {
    isDragging = true;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragX) + 'px';
    panel.style.right = 'auto';
    panel.style.top = (e.clientY - dragY) + 'px';
  });
  document.addEventListener('mouseup', function() { isDragging = false; });

}

// Run immediately if already on a consultation page
if (/\/consultations\/[a-f0-9-]+/.test(window.location.pathname)) {
  __olpInit();
}

// SPA navigation watcher — re-init whenever the URL changes to a consultation page
(function() {
  var lastPath = window.location.pathname;
  setInterval(function() {
    var currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      if (/\/consultations\/[a-f0-9-]+/.test(currentPath)) {
        // Small delay to let the SPA finish rendering the page
        setTimeout(__olpInit, 400);
      }
    }
  }, 300);
})();
