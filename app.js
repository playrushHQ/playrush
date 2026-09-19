(() => {
  "use strict";

  const state = {
    coins: 1250,
    xp: 0,
    posts: [
      {user:"@playrush", text:"Welcome to Playrush — sports, gaming and social in one place. 🚀", likes:12},
      {user:"@gamecenter", text:"Every game gets Main Feed + Play-by-Play (All) + Live Chat.", likes:8}
    ],
    selectedLeague: null,
    selectedGame: null,
    predictions: [
      {id:"p1", away:"Pistons", home:"Bulls", awayMod:-0.76, homeMod:0.24},
      {id:"p2", away:"Lions", home:"Bears", awayMod:0.10, homeMod:0.05}
    ]
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function showPage(id) {
    $$(".page").forEach(p => p.hidden = p.id !== id);
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.route === id));
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function renderCoins() {
    $("#coinBalance").textContent = state.coins.toLocaleString();
    $("#coinBalanceLarge").textContent = state.coins.toLocaleString();
    $("#xp").textContent = state.xp.toLocaleString();
  }

  function renderPosts() {
    const box = $("#posts");
    box.innerHTML = "";
    state.posts.forEach((post, index) => {
      const article = document.createElement("article");
      article.className = "post card";
      article.innerHTML = `
        <div class="post-head"><div class="avatar">P</div><div class="post-meta"><b>${escapeHtml(post.user)}</b><small>Just now · Community</small></div></div>
        <p>${escapeHtml(post.text)}</p>
        <div class="post-actions">
          <button type="button" data-like="${index}">♡ ${post.likes}</button>
          <button type="button" data-reply="${index}">↩ Reply</button>
          <button type="button" data-share="${index}">↗ Share</button>
        </div>`;
      box.appendChild(article);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function renderPredictions() {
    const box = $("#predictionCards");
    box.innerHTML = "";
    state.predictions.forEach(p => {
      const awayPct = Math.round(Math.abs(p.awayMod) * 100);
      const homePct = Math.round(Math.abs(p.homeMod) * 100);
      const awayLabel = p.away === "Pistons" ? "76% lower XP reward" : "10% XP modifier";
      const homeLabel = p.home === "Bulls" ? "24% higher XP reward" : "5% XP modifier";
      const card = document.createElement("article");
      card.className = "prediction card";
      card.innerHTML = `
        <div class="teams"><div><b>${escapeHtml(p.away)}</b><div class="muted">${awayLabel}</div></div><strong>VS</strong><div style="text-align:right"><b>${escapeHtml(p.home)}</b><div class="muted">${homeLabel}</div></div></div>
        <button class="primary pick" type="button" data-pick="${p.id}" data-team="${escapeHtml(p.away)}">Pick ${escapeHtml(p.away)}</button>
        <button class="secondary pick" type="button" data-pick="${p.id}" data-team="${escapeHtml(p.home)}">Pick ${escapeHtml(p.home)}</button>
        <div class="reward">Prediction reward = base XP × the selected team's configured modifier. No coins are wagered.</div>`;
      box.appendChild(card);
    });
  }

  function renderSchedule(league) {
    state.selectedLeague = league;
    const panel = $("#schedulePanel");
    panel.hidden = false;
    panel.innerHTML = `<h3>${escapeHtml(league)} — Games</h3><p class="muted">Live/historical data will populate here when SPORTS_API_BASE is configured.</p>`;
    const rows = league === "NBA"
      ? [["Pistons","Bulls"],["Celtics","Knicks"]]
      : [["Team A","Team B"],["Team C","Team D"]];
    rows.forEach(([away, home]) => {
      const row = document.createElement("div");
      row.className = "game-row";
      row.innerHTML = `<div><b>${escapeHtml(away)} @ ${escapeHtml(home)}</b><div class="muted">API data required for status and score</div></div><button class="secondary" type="button">Open Game</button>`;
      row.querySelector("button").addEventListener("click", () => openGame({away,home,league}));
      panel.appendChild(row);
    });
  }

  function openGame(game) {
    state.selectedGame = game;
    showPage("game");
    $("#awayTeam").textContent = game.away;
    $("#homeTeam").textContent = game.home;
    $("#awayScore").textContent = "—";
    $("#homeScore").textContent = "—";
    $("#gameStatus").textContent = "API DATA NEEDED";
    $("#gameClock").textContent = "No live feed connected";
    renderGameViews();
  }

  function renderGameViews() {
    $("#mainView").innerHTML = `
      <div class="card">
        <h3>Main Feed</h3>
        <p class="muted">When the game is active, this view should update from the sports API with score, clock/status, stats, leaders and key moments.</p>
        <div class="event"><span class="event-time">—</span><div><b>Waiting for live game data</b><div class="muted">No fabricated score or event is shown.</div></div></div>
      </div>`;
    $("#playsView").innerHTML = `
      <div class="card"><h3>Play-by-Play (All)</h3>
      <div class="event"><span class="event-time">—</span><div><b>Waiting for event stream</b><div class="muted">Recorded scores, fouls, rebounds, turnovers, substitutions, timeouts and other available events will appear here.</div></div></div></div>`;
    $("#chatView").innerHTML = `
      <div class="card"><h3>Live Chat</h3>
        <div class="chat-list" id="chatList"><div class="chat-message"><b>@playrush</b><span>Game chat is ready. Connect the backend for real-time shared chat.</span></div></div>
        <form class="chat-form" id="chatForm"><input class="chat-input" id="chatInput" maxlength="180" placeholder="Say something…" required><button class="primary" type="submit">Send</button></form>
      </div>`;
    $("#chatForm").addEventListener("submit", e => {
      e.preventDefault();
      const input = $("#chatInput");
      const text = input.value.trim();
      if (!text) return;
      const msg = document.createElement("div");
      msg.className = "chat-message";
      msg.innerHTML = `<b>@you</b><span>${escapeHtml(text)}</span>`;
      $("#chatList").appendChild(msg);
      input.value = "";
      $("#chatList").scrollTop = $("#chatList").scrollHeight;
    });
  }

  $$(".nav-btn, [data-route], .coin-pill").forEach(btn => {
    btn.addEventListener("click", e => {
      const route = e.currentTarget.dataset.route;
      if (route) showPage(route);
    });
  });

  $$(".league").forEach(btn => btn.addEventListener("click", () => renderSchedule(btn.dataset.league)));

  $$(".game-tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".game-tab").forEach(t => t.classList.toggle("active", t === tab));
    ["main","plays","chat"].forEach(id => $("#" + id + "View").hidden = tab.dataset.gameTab !== id);
  }));

  $("#postForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("#postInput");
    const text = input.value.trim();
    if (!text) return;
    state.posts.unshift({user:"@playrushzii", text, likes:0});
    input.value = "";
    renderPosts();
    toast("Posted.");
  });

  $("#posts").addEventListener("click", e => {
    const like = e.target.closest("[data-like]");
    const reply = e.target.closest("[data-reply]");
    const share = e.target.closest("[data-share]");
    if (like) { state.posts[Number(like.dataset.like)].likes++; renderPosts(); }
    if (reply) toast("Reply composer is ready for backend connection.");
    if (share) toast("Share action is ready.");
  });

  $("#predictionCards").addEventListener("click", e => {
    const pick = e.target.closest("[data-pick]");
    if (!pick) return;
    const prediction = state.predictions.find(p => p.id === pick.dataset.pick);
    const team = pick.dataset.team;
    const modifier = team === prediction.away ? prediction.awayMod : prediction.homeMod;
    const base = 100;
    const potential = Math.max(1, Math.round(base * (1 + modifier)));
    toast(`Prediction saved: ${team}. Potential reward: ${potential} XP when the real result is settled.`);
  });

  $$(".shop").forEach(item => item.addEventListener("click", () => {
    const cost = Number(item.dataset.cost);
    if (!Number.isFinite(cost) || cost < 0) return;
    if (state.coins < cost) { toast("Not enough coins."); return; }
    state.coins -= cost;
    renderCoins();
    toast(`${item.dataset.item} purchased.`);
  }));

  renderCoins();
  renderPosts();
  renderPredictions();
})();
