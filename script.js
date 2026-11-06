// Immediately Invoked Function Expression (IIFE): creates a private scope to avoid polluting global namespace
(function() {
  // Key used to store and retrieve flashcard data inside the browser's localStorage
  var KEY = "korean-anki-deck-v1";

  // Helper shortcut function to find DOM elements by their ID attribute
  var $ = function(id) { 
    return document.getElementById(id); 
  };

  // Application state holding the deck array, active card index, and configuration options
  var state = { 
    deck: [], 
    idx: 0, 
    flipped: false, 
    editing: null, 
    name: "Korean", 
    reverse: false 
  };

  // Loads persisted flashcard deck and settings from browser localStorage
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { 
        var s = JSON.parse(raw); 
        state.deck = s.deck || []; 
        state.name = s.name || "Korean"; 
        state.reverse = !!s.reverse; 
      }
    } catch(e) {
      // Gracefully handle parsing errors if stored JSON is corrupt
    }
    $("deckName").value = state.name;
    $("rev").checked = state.reverse;
  }

  // Serializes state data into a JSON string and writes it to localStorage
  function save() {
    try { 
      localStorage.setItem(KEY, JSON.stringify({ 
        deck: state.deck, 
        name: state.name, 
        reverse: state.reverse 
      })); 
    } catch(e) {}
  }

  // Sanitizes text to prevent Cross-Site Scripting (XSS) when inserting strings into HTML
  function esc(s) { 
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"); 
  }

  // Cleans whitespace, tabs, and newlines from user input strings
  function clean(s) { 
    return String(s || "").replace(/[\t\r\n]+/g, " ").trim(); 
  }

  // Displays a brief feedback popup message on screen
  function toast(msg) {
    var t = $("toast"); 
    t.textContent = msg; 
    t.classList.add("show");
    clearTimeout(toast._t); 
    toast._t = setTimeout(function() { 
      t.classList.remove("show"); 
    }, 1800);
  }

  // Generates a short pseudorandom unique identifier for each card
  function uid() { 
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); 
  }

  /* ==========================================================================
     TRANSLATION API INTEGRATION (English -> Korean via MyMemory REST API)
     ========================================================================== */
  function translate(word) {
    // API endpoint passing source English to Korean language pair and URL-encoded query
    var url = "https://api.mymemory.translated.net/get?langpair=en%7Cko&q=" + encodeURIComponent(word);
    
    // fetch() sends an asynchronous HTTP GET request across the network
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json(); // Parses JSON response body
    }).then(function(d) {
      var seen = {}, out = [];
      function add(t) {
        t = clean(t);
        // Validates that returned translation contains Korean Hangul characters
        if (!t || !/[\uAC00-\uD7A3]/.test(t) || seen[t]) return;
        seen[t] = 1; 
        out.push(t);
      }
      if (d.responseData) add(d.responseData.translatedText);
      (d.matches || []).forEach(function(m) { add(m.translation); });
      return out.slice(0, 5); // Return up to 5 translation matches
    });
  }

  var suggestSeq = 0, lastAuto = "", suggestTimer = null;
  function setStatus(msg) { $("tstatus").textContent = msg; }

  // Renders clickable word chips under the input field for alternative translations
  function showChips(list) {
    var box = $("chips"); 
    box.innerHTML = "";
    if (list.length < 2) return;
    list.forEach(function(t) {
      var b = document.createElement("button");
      b.type = "button"; 
      b.className = "chip"; 
      b.lang = "ko"; 
      b.textContent = t;
      b.addEventListener("click", function() { 
        $("ko").value = t; 
        lastAuto = t; 
      });
      box.appendChild(b);
    });
  }

  // Debounced translation suggestion handler triggered while user types in English
  function suggest() {
    var en = clean($("en").value), seq = ++suggestSeq;
    if (!en || state.editing !== null) {
      setStatus(""); 
      showChips([]);
      if (!en && state.editing === null && $("ko").value === lastAuto) $("ko").value = "";
      return;
    }
    setStatus("Translating…");
    translate(en).then(function(list) {
      if (seq !== suggestSeq) return; // Discard stale out-of-order network responses
      if (!list.length) { 
        setStatus("No Korean found for that. Type it in yourself."); 
        showChips([]); 
        return; 
      }
      var ko = $("ko");
      if (!ko.value || ko.value === lastAuto) { 
        ko.value = list[0]; 
        lastAuto = list[0]; 
      }
      setStatus(list.length > 1 ? "Translated. Tap another option below if the first one is off." : "Translated. Edit it if needed.");
      showChips(list);
    }).catch(function() {
      if (seq !== suggestSeq) return;
      setStatus("Could not reach the translation service. Type the Korean yourself.");
      showChips([]);
    });
  }

  // Debounces keystrokes by 600ms before triggering network API request
  $("en").addEventListener("input", function() {
    clearTimeout(suggestTimer); 
    suggestTimer = setTimeout(suggest, 600);
  });

  $("en").addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !$("ko").value) {
      e.preventDefault(); 
      clearTimeout(suggestTimer); 
      suggest();
    }
  });

  /* ==========================================================================
     DOM RENDERING & FLASHCARD VIEW
     ========================================================================== */
  // Renders current flashcard HTML into the preview container
  function renderStudy() {
    var area = $("studyArea"), d = state.deck;
    if (!d.length) {
      area.innerHTML = '<div class="empty">No cards yet. Add one on the left and it shows up here.</div>';
      $("count").textContent = ""; 
      return;
    }
    if (state.idx >= d.length) state.idx = d.length - 1;
    if (state.idx < 0) state.idx = 0;
    var c = d[state.idx];
    area.innerHTML =
      '<div class="stage"><div class="card' + (state.flipped ? " flipped" : "") + '" id="card" tabindex="0" role="button" aria-label="Flip card">' +
        '<div class="face"><span class="side">Korean</span><div class="big" lang="ko">' + esc(c.ko) + '</div></div>' +
        '<div class="face back"><span class="side">English</span><div class="mid">' + esc(c.en) + '</div>' +
          (c.ex ? '<div class="ex" lang="ko">' + esc(c.ex) + '</div>' : '') +
          (c.tags ? '<div class="small">' + esc(c.tags) + '</div>' : '') +
        '</div>' +
      '</div></div>';
    $("count").textContent = (state.idx + 1) + " of " + d.length;
    $("card").addEventListener("click", flip);
  }

  // Toggles card rotation state
  function flip() {
    if (!state.deck.length) return;
    state.flipped = !state.flipped;
    var c = $("card"); 
    if (c) c.classList.toggle("flipped", state.flipped);
  }

  // Navigates between cards in the deck
  function go(n) {
    if (!state.deck.length) return;
    state.idx = (state.idx + n + state.deck.length) % state.deck.length;
    state.flipped = false; 
    renderStudy(); 
    renderList();
  }

  // Renders the deck cards list at the bottom of the interface
  function renderList() {
    var ul = $("list");
    if (!state.deck.length) { 
      ul.innerHTML = ""; 
      return; 
    }
    ul.innerHTML = state.deck.map(function(c, i) {
      return '<li class="' + (i === state.idx ? "active" : "") + '" data-i="' + i + '">' +
        '<span class="k" lang="ko">' + esc(c.ko) + '</span><span class="e">' + esc(c.en) + '</span>' +
        '<button data-act="show">Show</button><button data-act="edit">Edit</button><button class="danger" data-act="del">Delete</button></li>';
    }).join("");
  }

  function renderAll() { 
    renderStudy(); 
    renderList(); 
  }

  // Appends a new flashcard object to the state deck array
  function addCard(ko, en, ex, tags) {
    ko = clean(ko); 
    en = clean(en);
    if (!ko || !en) return false;
    state.deck.push({ id: uid(), ko: ko, en: en, ex: clean(ex), tags: clean(tags) });
    return true;
  }

  /* ==========================================================================
     EVENT LISTENERS & USER INTERACTIONS
     ========================================================================== */
  // Handles form submission for adding or updating a card
  $("addForm").addEventListener("submit", function(e) {
    e.preventDefault();
    var f = e.target, ko = f.ko.value, en = f.en.value, ex = f.ex.value, tags = f.tags.value;
    if (state.editing !== null) {
      var c = state.deck[state.editing];
      c.ko = clean(ko); 
      c.en = clean(en); 
      c.ex = clean(ex); 
      c.tags = clean(tags);
      state.idx = state.editing; 
      endEdit(); 
      toast("Card updated");
    } else {
      if (!addCard(ko, en, ex, tags)) return;
      state.idx = state.deck.length - 1; 
      toast("Card added");
      f.ko.value = ""; 
      f.en.value = ""; 
      f.ex.value = ""; 
      lastAuto = "";
      suggestSeq++; 
      setStatus(""); 
      showChips([]); 
      f.en.focus();
    }
    state.flipped = false; 
    save(); 
    renderAll();
  });

  function endEdit() {
    state.editing = null; 
    $("addBtn").textContent = "Add card"; 
    $("cancelEdit").hidden = true;
    var f = $("addForm"); 
    f.ko.value = ""; 
    f.en.value = ""; 
    f.ex.value = "";
  }
  $("cancelEdit").addEventListener("click", endEdit);

  function sleep(ms) { 
    return new Promise(function(r) { setTimeout(r, ms); }); 
  }

  // Parses bulk words from textarea and asynchronously fetches translations
  $("bulkBtn").addEventListener("click", async function() {
    var lines = $("bulk").value.split(/\r?\n/).filter(function(l) { return l.trim(); });
    if (!lines.length) { 
      toast("Type one English word per line first"); 
      return; 
    }
    var btn = $("bulkBtn"), added = 0, failed = [];
    btn.disabled = true;
    for (var i = 0; i < lines.length; i++) {
      btn.textContent = "Translating " + (i + 1) + " of " + lines.length + "…";
      var p = lines[i].split(/\||\t/), en = clean(p[0]), ko = clean(p[1]), ex = clean(p.slice(2).join(" "));
      if (en && !ko) {
        try { 
          var r = await translate(en); 
          ko = r[0] || ""; 
        } catch(e) { 
          ko = ""; 
        }
        await sleep(250);
      }
      if (ko && addCard(ko, en, ex, "")) added++; 
      else failed.push(lines[i]);
    }
    btn.disabled = false; 
    btn.textContent = "Translate and add";
    $("bulk").value = failed.join("\n");
    if (added) { 
      state.idx = state.deck.length - added; 
      state.flipped = false; 
      save(); 
      renderAll(); 
    }
    toast(added + " added" + (failed.length ? ", " + failed.length + " not translated (left in the box)" : ""));
  });

  // Event delegation listener for card list actions (Show, Edit, Delete)
  $("list").addEventListener("click", function(e) {
    var b = e.target.closest("button"); 
    if (!b) return;
    var i = +b.closest("li").dataset.i, act = b.dataset.act;
    if (act === "show") { 
      state.idx = i; 
      state.flipped = false; 
      renderAll(); 
    }
    if (act === "del") { 
      state.deck.splice(i, 1); 
      if (state.editing !== null) endEdit(); 
      save(); 
      renderAll(); 
    }
    if (act === "edit") {
      var c = state.deck[i], f = $("addForm");
      f.ko.value = c.ko; 
      f.en.value = c.en; 
      f.ex.value = c.ex; 
      f.tags.value = c.tags;
      state.editing = i; 
      $("addBtn").textContent = "Save changes"; 
      $("cancelEdit").hidden = false;
      suggestSeq++; 
      setStatus(""); 
      showChips([]);
      f.ko.focus(); 
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  $("prev").addEventListener("click", function() { go(-1); });
  $("next").addEventListener("click", function() { go(1); });
  
  // Implements the Fisher-Yates array shuffling algorithm
  $("shuffle").addEventListener("click", function() {
    var d = state.deck;
    for (var i = d.length - 1; i > 0; i--) { 
      var j = Math.floor(Math.random() * (i + 1)); 
      var t = d[i]; 
      d[i] = d[j]; 
      d[j] = t; 
    }
    state.idx = 0; 
    state.flipped = false; 
    save(); 
    renderAll();
  });

  // Native Web Speech Synthesis API: reads the Korean front text out loud
  $("speak").addEventListener("click", function() {
    var c = state.deck[state.idx];
    if (!c) return;
    if (!("speechSynthesis" in window)) { 
      toast("This browser cannot read text aloud"); 
      return; 
    }
    var u = new SpeechSynthesisUtterance(c.ko); 
    u.lang = "ko-KR"; 
    u.rate = 0.85;
    speechSynthesis.cancel(); 
    speechSynthesis.speak(u);
  });

  // Global keyboard shortcuts for hands-free study navigation
  document.addEventListener("keydown", function(e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === " " && tag !== "button") { 
      e.preventDefault(); 
      flip(); 
    }
  });

  $("deckName").addEventListener("input", function(e) { 
    state.name = e.target.value; 
    save(); 
  });
  
  $("rev").addEventListener("change", function(e) { 
    state.reverse = e.target.checked; 
    save(); 
  });

  // Generates TSV (tab-separated value) format readable by Anki desktop
  function buildExport() {
    var rows = [], tag = clean(state.name).replace(/\s+/g, "_");
    function row(front, back, tags) { 
      rows.push([front, back, tags].join("\t")); 
    }
    state.deck.forEach(function(c) {
      var tags = ((c.tags ? c.tags + " " : "") + "korean").trim();
      var ex = c.ex ? "<br><br>" + esc(c.ex) : "";
      row(esc(c.ko), esc(c.en) + ex, tags);
      if (state.reverse) row(esc(c.en), esc(c.ko) + ex, tags);
    });
    var head = ["#separator:tab", "#html:true", "#tags column:3", "#deck:" + (clean(state.name) || "Korean")].join("\n");
    return head + "\n" + rows.join("\n") + "\n";
  }

  // Converts TSV text into an in-memory Blob and triggers download
  $("exportBtn").addEventListener("click", function() {
    if (!state.deck.length) { 
      toast("Add a card first"); 
      return; 
    }
    var blob = new Blob([buildExport()], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (clean(state.name).replace(/\s+/g, "_") || "korean") + "-anki.txt";
    document.body.appendChild(a); 
    a.click(); 
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    toast("Downloaded");
  });

  // Writes Anki TSV text directly to the user's OS clipboard
  $("copyBtn").addEventListener("click", function() {
    if (!state.deck.length) { 
      toast("Add a card first"); 
      return; 
    }
    var txt = buildExport();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(
        function() { toast("Copied"); }, 
        function() { toast("Copy blocked by the browser"); }
      );
    } else {
      toast("Copy is not available here");
    }
  });

  // Resets deck array and deletes saved flashcards
  $("clearBtn").addEventListener("click", function() {
    if (!state.deck.length) return;
    if (confirm("Delete all " + state.deck.length + " cards from this browser?")) {
      state.deck = []; 
      state.idx = 0; 
      state.flipped = false; 
      save(); 
      renderAll();
    }
  });

  // Initializes application on script load
  load(); 
  renderAll();
})();
