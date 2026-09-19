import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const COOKIE_NAME = "playrush_sid";
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "boxfights806@gmail.com";

const SPORTS = {
  nba: { path: "basketball/nba", label: "NBA", defaultSeason: "2026-27" },
  nfl: { path: "football/nfl", label: "NFL", defaultSeason: "2026" },
  mlb: { path: "baseball/mlb", label: "MLB", defaultSeason: "2026" },
  nhl: { path: "hockey/nhl", label: "NHL", defaultSeason: "2026-27" }
};

const STORE = [
  { id: "coins-500", type: "coins", name: "500 Rush Coins", description: "Power up your Playrush wallet.", amount: 499, coins: 500, category: "Currency", accent: "gold" },
  { id: "coins-1200", type: "coins", name: "1,200 Rush Coins", description: "The everyday Playrush coin pack.", amount: 899, coins: 1200, category: "Currency", accent: "gold", badge: "POPULAR" },
  { id: "coins-3000", type: "coins", name: "3,000 Rush Coins", description: "The big wallet boost for collectors.", amount: 1999, coins: 3000, category: "Currency", accent: "gold" },
  { id: "supporter-badge", type: "cosmetic", name: "Playrush Supporter", description: "A permanent supporter badge for your profile and posts.", amount: 399, coinPrice: 500, entitlement: "supporter-badge", category: "Profile", accent: "blue" },
  { id: "pro-frame", type: "cosmetic", name: "Pro Game Frame", description: "Unlock the premium Game Center profile frame.", amount: 699, coinPrice: 900, entitlement: "pro-frame", category: "Profile", accent: "violet" },
  { id: "season-pass", type: "cosmetic", name: "Game Center Pass", description: "A premium profile marker for the current sports cycle.", amount: 999, coinPrice: 1500, entitlement: "season-pass-2026", category: "Profile", accent: "green", badge: "NEW" }
];

const memory = {
  supportTickets: new Map(),
  users: new Map(), posts: [], orders: new Map(), entitlements: new Map(), walletLedger: new Map(), wagers: new Map(), likes: new Set()
};
let db = null;
if (process.env.DATABASE_URL) {
  db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
}

const cache = new Map();
const TTL = { schedule: 45_000, historicalSchedule: 6 * 60 * 60_000, game: 15_000 };
const cached = (key, ttl) => { const item = cache.get(key); return item && Date.now() - item.time < ttl ? item.value : null; };
const put = (key, value) => { cache.set(key, { time: Date.now(), value }); return value; };

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const sign = value => crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
const makeSession = userId => `${userId}.${sign(userId)}`;
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map(x => x.trim().split("=")).filter(x => x.length === 2).map(([k, v]) => [k, decodeURIComponent(v)])); }
function validSession(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return null;
  const [userId, signature] = raw.split(".");
  const expected = sign(userId);
  if (!userId || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return userId;
}
function setSession(res, userId) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(makeSession(userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

async function initDb() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, handle text NOT NULL, email text, coins integer NOT NULL DEFAULT 0,
      xp integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_session_id text UNIQUE, product_id text NOT NULL, amount integer NOT NULL, currency text NOT NULL,
      status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), fulfilled_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, entitlement text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, entitlement)
    );
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL, amount integer NOT NULL, balance_after integer NOT NULL,
      reference_id text, description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject text NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS support_tickets_user_created_idx ON support_tickets(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS wagers (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sport text NOT NULL, game_id text NOT NULL, selection text NOT NULL,
      stake integer NOT NULL CHECK(stake > 0), odds numeric(6,3) NOT NULL,
      potential_payout integer NOT NULL, status text NOT NULL DEFAULT 'open',
      result text, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS wagers_game_status_idx ON wagers(game_id, status);
    CREATE INDEX IF NOT EXISTS wagers_user_created_idx ON wagers(user_id, created_at DESC);
  `);
}

async function createUser(req, res) {
  let userId = validSession(req);
  if (userId) {
    const existing = await getUser(userId);
    if (existing) return existing;
  }
  userId = uid();
  const user = { id: userId, handle: `fan_${userId.slice(0, 6)}`, email: null, coins: 1000, xp: 0 };
  if (db) { await db.query("INSERT INTO users(id, handle, email, coins, xp) VALUES($1,$2,$3,$4,$5)", [user.id, user.handle, null, 1000, 0]); await db.query("INSERT INTO wallet_transactions(id,user_id,kind,amount,balance_after,description) VALUES($1,$2,'starter',1000,1000,'Starter Rush Coins')", [uid(), user.id]); } else { memory.users.set(user.id, user); walletTransactionMemory(user.id,'starter',1000,1000,null,'Starter Rush Coins'); }
  setSession(res, user.id);
  return user;
}

async function getUser(id) {
  if (!id) return null;
  if (db) return (await db.query("SELECT id, handle, email, coins, xp FROM users WHERE id=$1", [id])).rows[0] || null;
  return memory.users.get(id) || null;
}
async function requireUser(req, res) { const existing = await getUser(validSession(req)); return existing || createUser(req, res); }

async function updateUser(userId, patch) {
  if (db) {
    const fields = Object.keys(patch); const values = Object.values(patch);
    const set = fields.map((f, i) => `${f}=$${i + 2}`).join(", ");
    return (await db.query(`UPDATE users SET ${set} WHERE id=$1 RETURNING id, handle, email, coins, xp`, [userId, ...values])).rows[0];
  }
  const user = memory.users.get(userId); Object.assign(user, patch); return user;
}

async function addCoins(userId, amount, kind='credit', referenceId=null, description='Rush Coins credited') {
  return changeCoins(userId, Number(amount), kind, referenceId, description);
}
async function grantEntitlement(userId, entitlement) {
  if (!entitlement) return;
  if (db) await db.query("INSERT INTO entitlements(user_id, entitlement) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, entitlement]);
  else { if (!memory.entitlements.has(userId)) memory.entitlements.set(userId, new Set()); memory.entitlements.get(userId).add(entitlement); }
}
async function hasEntitlement(userId, entitlement) {
  if (db) return (await db.query("SELECT 1 FROM entitlements WHERE user_id=$1 AND entitlement=$2", [userId, entitlement])).rowCount > 0;
  return memory.entitlements.get(userId)?.has(entitlement) || false;
}

async function listPosts() {
  if (db) {
    const { rows } = await db.query(`SELECT p.id,p.body,p.created_at,u.handle,COUNT(pl.post_id)::int AS likes FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN post_likes pl ON pl.post_id=p.id GROUP BY p.id,u.handle ORDER BY p.created_at DESC LIMIT 100`);
    return rows.map(p => ({ id:p.id, user:`@${p.handle}`, text:p.body, likes:p.likes, createdAt:p.created_at }));
  }
  return memory.posts.slice().reverse().slice(0, 100);
}
async function createPost(userId, body) {
  if (db) {
    const id = uid(); await db.query("INSERT INTO posts(id,user_id,body) VALUES($1,$2,$3)",[id,userId,body]); return { id, body };
  }
  const user = memory.users.get(userId); const post = { id:uid(), user:`@${user.handle}`, text:body, likes:0, createdAt:nowIso() }; memory.posts.push(post); return post;
}
async function likePost(userId, postId) {
  if (db) {
    try { await db.query("INSERT INTO post_likes(post_id,user_id) VALUES($1,$2)",[postId,userId]); } catch {}
    return;
  }
  const key = `${postId}:${userId}`; if (memory.likes.has(key)) return; memory.likes.add(key); const p=memory.posts.find(x=>x.id===postId); if(p)p.likes++;
}

function walletTransactionMemory(userId, kind, amount, balanceAfter, referenceId, description) {
  if (!memory.walletLedger.has(userId)) memory.walletLedger.set(userId, []);
  memory.walletLedger.get(userId).push({ id: uid(), kind, amount, balanceAfter, referenceId, description, createdAt: nowIso() });
}
async function changeCoins(userId, delta, kind, referenceId, description) {
  if (db) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query('SELECT coins FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!row.rows[0]) throw new Error('User not found.');
      const next = Number(row.rows[0].coins) + Number(delta);
      if (next < 0) throw new Error('Insufficient Rush Coins.');
      await client.query('UPDATE users SET coins=$2 WHERE id=$1', [userId, next]);
      await client.query('INSERT INTO wallet_transactions(id,user_id,kind,amount,balance_after,reference_id,description) VALUES($1,$2,$3,$4,$5,$6,$7)', [uid(), userId, kind, delta, next, referenceId || null, description]);
      await client.query('COMMIT');
      return next;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  const user = memory.users.get(userId);
  if (!user) throw new Error('User not found.');
  const next = Number(user.coins) + Number(delta);
  if (next < 0) throw new Error('Insufficient Rush Coins.');
  user.coins = next;
  walletTransactionMemory(userId, kind, delta, next, referenceId, description);
  return next;
}
async function listWagers(userId) {
  if (db) {
    const { rows } = await db.query(`SELECT id,sport,game_id AS "gameId",selection,stake,odds,potential_payout AS "potentialPayout",status,result,created_at AS "createdAt",settled_at AS "settledAt" FROM wagers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]);
    return rows;
  }
  return [...(memory.wagers?.values() || [])].filter(w => w.userId === userId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100);
}
async function insertWager(wager) {
  if (db) {
    await db.query(`INSERT INTO wagers(id,user_id,sport,game_id,selection,stake,odds,potential_payout,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open')`, [wager.id,wager.userId,wager.sport,wager.gameId,wager.selection,wager.stake,wager.odds,wager.potentialPayout]);
    return;
  }
  if (!memory.wagers) memory.wagers = new Map();
  memory.wagers.set(wager.id, wager);
}
async function openWagersForGame(sport, gameId) {
  if (db) return (await db.query(`SELECT id,user_id AS "userId",selection,stake,odds,potential_payout AS "potentialPayout" FROM wagers WHERE sport=$1 AND game_id=$2 AND status='open'`, [sport,gameId])).rows;
  return [...(memory.wagers?.values() || [])].filter(w=>w.sport===sport&&w.gameId===gameId&&w.status==='open');
}
async function settleGameWagers(game) {
  if (!game || !['final','post'].includes(String(game.state||'').toLowerCase())) return 0;
  const away = Number(game.away?.score), home = Number(game.home?.score);
  if (!Number.isFinite(away) || !Number.isFinite(home) || away === home) return 0;
  const winner = away > home ? 'away' : 'home';
  const wagers = await openWagersForGame(game.sport || 'nba', game.id);
  let settled = 0;
  for (const w of wagers) {
    const won = w.selection === winner;
    if (db) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const lock = await client.query(`SELECT status FROM wagers WHERE id=$1 FOR UPDATE`, [w.id]);
        if (!lock.rows[0] || lock.rows[0].status !== 'open') { await client.query('ROLLBACK'); continue; }
        if (won) {
          const row = await client.query('UPDATE users SET coins=coins+$2 WHERE id=$1 RETURNING coins', [w.userId, Number(w.potentialPayout)]);
          await client.query("INSERT INTO wallet_transactions(id,user_id,kind,amount,balance_after,reference_id,description) VALUES($1,$2,'settlement',$3,$4,$5,$6)", [uid(),w.userId,Number(w.potentialPayout),row.rows[0].coins,w.id,`Wager won — ${game.away?.name || 'Away'} vs ${game.home?.name || 'Home'}`]);
        }
        await client.query(`UPDATE wagers SET status=$2,result=$3,settled_at=now() WHERE id=$1`, [w.id, won ? 'won' : 'lost', won ? 'win' : 'loss']);
        await client.query('COMMIT'); settled++;
      } catch(e) { await client.query('ROLLBACK'); } finally { client.release(); }
    } else {
      if (!memory.wagers?.has(w.id)) continue;
      const current = memory.wagers.get(w.id); if (current.status !== 'open') continue;
      if (won) { const balance = await changeCoins(w.userId, Number(w.potentialPayout), 'settlement', w.id, 'Wager won'); current.balanceAfter = balance; }
      current.status = won ? 'won' : 'lost'; current.result = won ? 'win' : 'loss'; current.settledAt = nowIso(); settled++;
    }
  }
  return settled;
}

function normalizeSport(sport) { const key = String(sport || "nba").toLowerCase(); if (!SPORTS[key]) throw new Error(`Unsupported sport: ${key}`); return SPORTS[key]; }
function normalizeSeason(sportKey, season) { const s=normalizeSport(sportKey); return season && /^(\d{4})(?:-(\d{2}))?$/.test(season) ? season : s.defaultSeason; }
function seasonYear(_sportKey, season) { const m=String(season).match(/^(\d{4})/); return m ? Number(m[1]) : 2026; }
function seasonDates(sportKey, season) { const y=seasonYear(sportKey,season); if(sportKey==='nfl')return [`${y}-08-01`,`${y}-02-28`]; if(sportKey==='mlb')return [`${y}-02-01`,`${y}-11-10`]; return [`${y}-09-15`,`${y+1}-07-15`]; }
function isoDay(date) { return new Date(`${date}T00:00:00Z`).toISOString().slice(0,10); }
function ymd(date) { return date.toISOString().slice(0,10).replaceAll('-',''); }
function addDays(date, amount) { const d=new Date(date); d.setUTCDate(d.getUTCDate()+amount); return d; }
async function espn(pathname, params={}) { const url=new URL(`https://site.api.espn.com/apis/site/v2/sports/${pathname}`); for(const [k,v] of Object.entries(params))if(v!==undefined&&v!=="")url.searchParams.set(k,v); let last; for(let i=0;i<3;i++){try{const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Playrush/3.0'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`Sports provider returned HTTP ${r.status}`);return await r.json();}catch(e){last=e;if(i<2)await new Promise(r=>setTimeout(r,500*(i+1)));}}throw last; }
function competitionStatus(event){const c=event?.competitions?.[0],s=c?.status?.type?.state;if(s==='in')return 'LIVE';if(s==='post')return c?.status?.type?.shortDetail||'FINAL';return c?.status?.type?.shortDetail||'Scheduled';}
function eventDate(event){return event?.date||event?.competitions?.[0]?.date||null;}
function eventTeams(event){const cs=event?.competitions?.[0]?.competitors||[];const home=cs.find(c=>c.homeAway==='home')||cs[1],away=cs.find(c=>c.homeAway==='away')||cs[0];const team=c=>({id:c?.team?.id||c?.id||'',name:c?.team?.displayName||c?.team?.name||'',abbreviation:c?.team?.abbreviation||'',shortName:c?.team?.shortDisplayName||c?.team?.name||'',logo:c?.team?.logo||c?.team?.logos?.[0]?.href||'',score:c?.score===undefined?null:Number(c.score),winner:Boolean(c?.winner),record:c?.records?.[0]?.summary||''});return{away:team(away||{}),home:team(home||{})};}
function normalizeEvent(event,sport,season,stage){const teams=eventTeams(event),c=event?.competitions?.[0]||{};return{id:String(event?.id||''),gameId:String(event?.id||''),uid:event?.uid||'',date:eventDate(event),name:event?.name||`${teams.away.name} at ${teams.home.name}`,shortName:event?.shortName||`${teams.away.abbreviation} @ ${teams.home.abbreviation}`,status:competitionStatus(event),state:c?.status?.type?.state||'pre',live:(c?.status?.type?.state||'pre')==='in',sport,season,stage,venue:c?.venue?.fullName||c?.venue?.address?.city||'',broadcast:c?.broadcasts?.map(x=>x.names?.[0]).filter(Boolean).join(', ')||'',away:teams.away,home:teams.home};}
function stageParam(stage){const s=String(stage||'Regular Season').toLowerCase();if(s.includes('preseason'))return'1';if(s.includes('post')||s.includes('playoff'))return'3';return'2';}
async function fetchScheduleChunk(sportKey,season,from,to,stage){const s=normalizeSport(sportKey);const data=await espn(s.path,{dates:`${ymd(new Date(`${from}T00:00:00Z`))}-${ymd(new Date(`${to}T00:00:00Z`))}`,seasontype:stageParam(stage),limit:1000});return(data.events||[]).map(e=>normalizeEvent(e,sportKey,season,stage));}
async function getSchedule(sportKey,season,stage,date){const [start,end]=seasonDates(sportKey,season);if(date){const key=`schedule:${sportKey}:${season}:${stage}:${date}`,hit=cached(key,TTL.schedule);if(hit)return hit;return put(key,await fetchScheduleChunk(sportKey,season,date,date,stage));}const key=`schedule:${sportKey}:${season}:${stage}`,ttl=String(season)===String(normalizeSport(sportKey).defaultSeason)?TTL.schedule:TTL.historicalSchedule,hit=cached(key,ttl);if(hit)return hit;const chunks=[];let cur=new Date(`${start}T00:00:00Z`),endDate=new Date(`${end}T00:00:00Z`);while(cur<=endDate){const ce=addDays(cur,30),to=ce>endDate?endDate:ce;chunks.push([isoDay(cur),isoDay(to)]);cur=addDays(to,1);}const results=[];for(const [from,to] of chunks)results.push(...await fetchScheduleChunk(sportKey,season,from,to,stage));return put(key,[...new Map(results.filter(g=>g.id).map(g=>[g.id,g])).values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))));}
function normalizePlay(play){const text=play?.text||play?.shortText||play?.description||'';const team=play?.team;return{id:String(play?.id||play?.sequence||`${play?.clock?.value||''}-${text.slice(0,20)}`),period:play?.period?.number??null,clock:play?.clock?.displayValue||play?.clock?.value||'',text,shortText:play?.shortText||text,scoringPlay:Boolean(play?.scoringPlay),scoreValue:play?.scoreValue??null,awayScore:play?.awayScore??null,homeScore:play?.homeScore??null,team:team?{id:team.id,abbreviation:team.abbreviation,displayName:team.displayName}:null,type:play?.type?.text||play?.type?.abbreviation||'',description:text,teamTricode:team?.abbreviation||'',score:play?.awayScore!=null&&play?.homeScore!=null?`${play.awayScore}–${play.homeScore}`:'',scoring:Boolean(play?.scoringPlay)};}
function boxPlayers(summary){const rows=[];for(const team of summary?.boxscore?.players||[])for(const group of team.statistics||[]){const labels=group.labels||[];for(const athlete of group.athletes||[]){const stats=athlete.statistics||[],obj=Object.fromEntries(labels.map((label,i)=>[label,stats[i]]));rows.push({team:team.team?.abbreviation||team.team?.shortDisplayName||'',name:athlete.athlete?.displayName||'',starter:Boolean(athlete.starter),stats:obj,raw:stats,min:obj.MIN||obj.Minutes||null,pts:obj.PTS||obj.Points||null,reb:obj.REB||obj.Rebounds||null,ast:obj.AST||obj.Assists||null,stl:obj.STL||obj.Steals||null,blk:obj.BLK||obj.Blocks||null});}}return rows;}
async function getGame(sportKey,id){const key=`game:${sportKey}:${id}`,hit=cached(key,TTL.game);if(hit)return hit;const s=normalizeSport(sportKey),summary=await espn(`${s.path}/summary`,{event:id}),competition=summary?.header?.competitions?.[0]||{};const event={id,date:competition.date,name:competition.competitors?`${competition.competitors.find(c=>c.homeAway==='away')?.team?.displayName||'Away'} at ${competition.competitors.find(c=>c.homeAway==='home')?.team?.displayName||'Home'}`:'',competitions:summary?.header?.competitions};const normalized=normalizeEvent(event,sportKey,summary?.header?.season?.displayName||'',summary?.header?.season?.type?.text||'');const plays=(summary?.plays||[]).map(normalizePlay);return put(key,{...normalized,sport:sportKey,status:competition?.status?.type?.shortDetail||normalized.status,state:competition?.status?.type?.state||normalized.state,clock:competition?.status?.type?.shortDetail||'',venue:competition?.venue?.fullName||normalized.venue,broadcast:competition?.broadcasts?.map(x=>x.names?.[0]).filter(Boolean).join(', ')||normalized.broadcast,plays,boxScore:{players:boxPlayers(summary)},leaders:summary?.leaders||[],notes:summary?.notes||[],odds:summary?.odds||[]});}

function stripeForm(params){const p=new URLSearchParams();const add=(k,v)=>{if(v===undefined||v===null)return;if(typeof v==='object'&&!Array.isArray(v))for(const [ck,cv] of Object.entries(v))add(`${k}[${ck}]`,cv);else p.append(k,String(v));};for(const [k,v] of Object.entries(params))add(k,v);return p;}
async function stripeApi(resource, params, method='POST'){if(!stripe)throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY to the deployment environment.');const r=await fetch(`https://api.stripe.com/v1/${resource}`,{method,headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body:method==='GET'?undefined:stripeForm(params)});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`Stripe HTTP ${r.status}`);return data;}
function findProduct(id){return STORE.find(p=>p.id===id);}

// Stripe webhook must receive the raw request body. It is registered before express.json().
app.post('/api/stripe/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  try {
    const signature=req.headers['stripe-signature'];
    if(!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook secret not configured');
    const event=Stripe.webhooks.constructEvent(req.body,signature,process.env.STRIPE_WEBHOOK_SECRET);
    if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded') await fulfillCheckout(event.data.object);
    res.json({received:true});
  } catch(e) { res.status(400).send(`Webhook Error: ${e.message}`); }
});

app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname,{extensions:['html']}));

async function fulfillCheckout(session){
  const userId=session?.metadata?.userId||session?.client_reference_id; const productId=session?.metadata?.productId;
  if(!userId||!productId)return; const product=findProduct(productId); if(!product)return;
  if(db){
    const orderId=uid();
    const inserted=await db.query(`INSERT INTO orders(id,user_id,stripe_session_id,product_id,amount,currency,status,fulfilled_at) VALUES($1,$2,$3,$4,$5,$6,'paid',now()) ON CONFLICT(stripe_session_id) DO NOTHING RETURNING id`,[orderId,userId,session.id,productId,session.amount_total||product.amount,session.currency||'usd']);
    if(!inserted.rowCount)return;
  } else { if(memory.orders.has(session.id))return; memory.orders.set(session.id,{id:uid(),userId,productId,amount:session.amount_total||product.amount,status:'paid',createdAt:nowIso()}); }
  if(product.type==='coins') await addCoins(userId,product.coins,'purchase',session.id,`Purchased ${product.name}`); else await grantEntitlement(userId,product.entitlement);
  if(session.customer_details?.email) await updateUser(userId,{email:session.customer_details.email});
}

app.get('/api/config',(_req,res)=>res.json({stripePublishableKey:process.env.STRIPE_PUBLISHABLE_KEY||''}));
app.get('/api/health',async(_req,res)=>res.json({ok:true,service:'Playrush',sportsProvider:'ESPN public sports feed',payments:Boolean(stripe),database:Boolean(db),time:nowIso()}));
app.get('/api/sports',(_req,res)=>res.json(Object.entries(SPORTS).map(([id,s])=>({id,label:s.label,currentSeason:s.defaultSeason}))));
app.get('/api/schedule',async(req,res)=>{try{const sport=String(req.query.sport||'nba').toLowerCase(),season=normalizeSeason(sport,req.query.season),stage=String(req.query.stage||'Regular Season'),date=String(req.query.date||'');const games=await getSchedule(sport,season,stage,date);res.json({sport,season,stage,date,count:games.length,games,generatedAt:nowIso()});}catch(e){res.status(502).json({error:`Sports data request failed: ${e?.message||e}`});}});
app.get('/api/games/:id',async(req,res)=>{try{const sport=String(req.query.sport||'nba').toLowerCase();if(!/^[A-Za-z0-9_-]+$/.test(req.params.id))return res.status(400).json({error:'Invalid game ID.'});const game=await getGame(sport,req.params.id);const settled=await settleGameWagers(game);res.json({...game,wagersSettled:settled});}catch(e){res.status(502).json({error:`Game data request failed: ${e?.message||e}`});}});

app.get('/api/me',async(req,res)=>{const user=await requireUser(req,res);const ent=[];for(const p of STORE.filter(x=>x.type==='cosmetic'))if(await hasEntitlement(user.id,p.entitlement))ent.push(p.entitlement);res.json({...user,entitlements:ent});});
app.patch('/api/me',async(req,res)=>{const user=await requireUser(req,res),handle=String(req.body?.handle||'').trim().replace(/^@/,'').slice(0,24),email=String(req.body?.email||'').trim().slice(0,200);if(handle&&!/^[A-Za-z0-9_]+$/.test(handle))return res.status(400).json({error:'Handle may only use letters, numbers and underscores.'});const updated=await updateUser(user.id,{...(handle?{handle}:{}),...(email?{email}:{})});res.json(updated);});
app.get('/api/feed',async(_req,res)=>res.json({posts:await listPosts()}));
app.post('/api/feed',async(req,res)=>{const user=await requireUser(req,res),body=String(req.body?.body||'').trim();if(!body||body.length>280)return res.status(400).json({error:'Post must be 1–280 characters.'});res.status(201).json(await createPost(user.id,body));});
app.post('/api/feed/:id/like',async(req,res)=>{const user=await requireUser(req,res);await likePost(user.id,req.params.id);res.json({ok:true});});
app.post('/api/support',async(req,res)=>{try{const user=await requireUser(req,res),subject=String(req.body?.subject||'').trim().slice(0,120),message=String(req.body?.message||'').trim().slice(0,2000);if(!subject||!message)return res.status(400).json({error:'Subject and message are required.'});const id=uid();if(db) await db.query('INSERT INTO support_tickets(id,user_id,subject,message) VALUES($1,$2,$3,$4)',[id,user.id,subject,message]);else memory.supportTickets ||= new Map(), memory.supportTickets.set(id,{id,userId:user.id,subject,message,createdAt:nowIso()});
    const ticketEmail=`Playrush Support Ticket ${id}`;
    const text=[`Ticket: ${id}`,`User: ${user.handle}`,`User ID: ${user.id}`,`Email: ${user.email || 'not provided'}`,`Subject: ${subject}`,'',message].join('\n');
    if(process.env.RESEND_API_KEY){
      const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.SUPPORT_FROM_EMAIL || 'Playrush Support <onboarding@resend.dev>',to:[SUPPORT_EMAIL],reply_to:user.email||undefined,subject:ticketEmail,text})});
      if(!r.ok) console.error('Support email failed:',await r.text());
    } else { console.warn(`Support ticket ${id} saved but no RESEND_API_KEY is configured. Send to ${SUPPORT_EMAIL}.`); }
    res.status(201).json({ok:true,ticketId:id,supportEmail:SUPPORT_EMAIL});}catch(e){res.status(500).json({error:e.message||'Unable to submit support request.'});}});

app.get('/api/wallet',async(req,res)=>{const user=await requireUser(req,res);let transactions=[];if(db){transactions=(await db.query(`SELECT kind,amount,balance_after AS "balanceAfter",reference_id AS "referenceId",description,created_at AS "createdAt" FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[user.id])).rows;}else transactions=memory.walletLedger.get(user.id)||[];res.json({coins:user.coins,transactions});});
app.get('/api/wagers',async(req,res)=>{const user=await requireUser(req,res);res.json({wagers:await listWagers(user.id),coins:user.coins,virtualCurrency:true});});
app.post('/api/wagers',async(req,res)=>{
  try {
    const user=await requireUser(req,res); const sport=String(req.body?.sport||'nba').toLowerCase(); const gameId=String(req.body?.gameId||''); const selection=String(req.body?.selection||''); const stake=Math.floor(Number(req.body?.stake));
    if(!/^[A-Za-z0-9_-]+$/.test(gameId)) return res.status(400).json({error:'Invalid game.'});
    if(!['away','home'].includes(selection)) return res.status(400).json({error:'Choose a team.'});
    if(!Number.isInteger(stake)||stake<10||stake>100000) return res.status(400).json({error:'Wagers must be 10–100,000 Rush Coins.'});
    const game=await getGame(sport,gameId); const live=['in','live'].includes(String(game.state||'').toLowerCase());
    if(['final','post'].includes(String(game.state||'').toLowerCase())) return res.status(409).json({error:'This game is final. Wagering is closed.'});
    const odds=live?1.75:1.9; const payout=Math.floor(stake*odds);
    const id=uid(); await changeCoins(user.id,-stake,'wager',id,`Wager on ${selection==='home'?(game.home?.name||'Home'):(game.away?.name||'Away')}`);
    await insertWager({id,userId:user.id,sport,gameId,selection,stake,odds,potentialPayout:payout,status:'open',result:null,createdAt:nowIso(),settledAt:null});
    res.status(201).json({ok:true,wager:{id,sport,gameId,selection,stake,odds,potentialPayout:payout,status:'open'},coins:(await getUser(user.id)).coins,virtualCurrency:true});
  } catch(e){res.status(400).json({error:e.message||'Unable to place wager.'});}
});

app.get('/api/store',async(req,res)=>{const user=await requireUser(req,res);res.json({currency:'USD',stripeConfigured:Boolean(stripe),items:STORE,coins:user.coins,entitlements:STORE.filter(x=>x.entitlement).reduce((a,x)=>{a[x.entitlement]=false;return a},{}),setupMessage:stripe?'':'Store is in demo mode until STRIPE_SECRET_KEY is configured.'});});
app.post('/api/store/redeem',async(req,res)=>{
  try {
    const user=await requireUser(req,res), product=findProduct(req.body?.productId);
    if(!product || product.type!=='cosmetic' || !product.coinPrice) return res.status(400).json({error:'This item cannot be redeemed with Rush Coins.'});
    if(await hasEntitlement(user.id,product.entitlement)) return res.status(409).json({error:'You already own this item.'});
    if(db){
      const client=await db.connect();
      try {
        await client.query('BEGIN');
        const row=await client.query('SELECT coins FROM users WHERE id=$1 FOR UPDATE',[user.id]);
        if(!row.rows[0] || row.rows[0].coins < product.coinPrice){await client.query('ROLLBACK');return res.status(400).json({error:`You need ${product.coinPrice.toLocaleString()} Rush Coins.`});}
        await client.query('UPDATE users SET coins=coins-$2 WHERE id=$1',[user.id,product.coinPrice]);
        await client.query('INSERT INTO entitlements(user_id,entitlement) VALUES($1,$2)',[user.id,product.entitlement]);
        await client.query('COMMIT');
      } catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
    } else {
      const current=memory.users.get(user.id); if(current.coins < product.coinPrice) return res.status(400).json({error:`You need ${product.coinPrice.toLocaleString()} Rush Coins.`});
      current.coins -= product.coinPrice; await grantEntitlement(user.id,product.entitlement);
    }
    const updated=await getUser(user.id); res.json({ok:true,user:updated,entitlement:product.entitlement});
  } catch(e){res.status(500).json({error:e.message||'Unable to redeem item.'});}
});

app.post('/api/store/checkout',async(req,res)=>{try{const user=await requireUser(req,res),product=findProduct(req.body?.productId);if(!product)return res.status(404).json({error:'Product not found.'});if(!stripe)return res.status(503).json({error:'Payments are not configured yet. Add STRIPE_SECRET_KEY to enable real purchases.'});const session=await stripe.checkout.sessions.create({ui_mode:'embedded_page',mode:'payment',customer_email:user.email||undefined,customer_creation:'always',client_reference_id:user.id,metadata:{userId:user.id,productId:product.id},line_items:[{price_data:{currency:'usd',product_data:{name:product.name,description:product.description},unit_amount:product.amount},quantity:1}],return_url:`${PUBLIC_URL}/#store?session_id={CHECKOUT_SESSION_ID}`});res.json({clientSecret:session.client_secret,sessionId:session.id});}catch(e){res.status(500).json({error:e.message||'Unable to create checkout.'});}});
app.get('/api/store/session/:id',async(req,res)=>{try{if(!stripe)return res.status(503).json({error:'Payments are not configured.'});const session=await stripe.checkout.sessions.retrieve(req.params.id);res.json({status:session.status,paymentStatus:session.payment_status,email:session.customer_details?.email||null});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/store/portal',async(req,res)=>{try{const user=await requireUser(req,res);if(!stripe)return res.status(503).json({error:'Payments are not configured.'});if(!user.email)return res.status(400).json({error:'Complete a purchase first so Playrush can associate a Stripe customer with your profile.'});const sessions=await stripe.customers.search({query:`email:'${user.email.replaceAll("'","\\'")}'`});const customer=sessions.data[0];if(!customer)return res.status(404).json({error:'No Stripe customer found for this profile yet.'});const portal=await stripe.billingPortal.sessions.create({customer:customer.id,return_url:`${PUBLIC_URL}/#profile`});res.json({url:portal.url});}catch(e){res.status(500).json({error:e.message});}});

app.use((_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb().then(()=>app.listen(PORT,HOST,()=>console.log(`Playrush listening on ${HOST}:${PORT}`))).catch(error=>{console.error('Database initialization failed',error);process.exit(1);});
