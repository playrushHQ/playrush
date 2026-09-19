import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 8787);
const NBA = "https://stats.nba.com/stats";
const cache = new Map();
const TTL = { schedule: 10 * 60_000, game: 5 * 60_000 };

function cached(key, ttl) { const hit = cache.get(key); return hit && Date.now() - hit.time < ttl ? hit.value : null; }
function put(key, value) { cache.set(key, { time: Date.now(), value }); return value; }
function rows(resultSet) { return resultSet?.rowSet?.map(row => Object.fromEntries(resultSet.headers.map((h,i)=>[h,row[i]]))) || []; }
function dataset(json, name) { return (json.resultSets || []).find(x => x.name === name); }
async function nba(endpoint, params) {
  const u = new URL(`${NBA}/${endpoint}`); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  let last;
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const r = await fetch(u, { headers: {
        "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        "Referer":"https://www.nba.com/", "Origin":"https://www.nba.com", "Accept":"application/json,text/plain,*/*", "x-nba-stats-origin":"stats", "x-nba-stats-token":"true"
      }});
      if (!r.ok) throw new Error(`NBA Stats returned HTTP ${r.status}`);
      return await r.json();
    } catch(e) { last=e; await new Promise(r=>setTimeout(r, 700*(attempt+1))); }
  }
  throw last;
}
function seasonOk(s){ return /^\d{4}-\d{2}$/.test(s) && Number(s.slice(0,4)) >= 1996 && Number(s.slice(0,4)) <= 2035; }
function normalizeGameRows(raw) {
  const map = new Map();
  for (const r of raw) {
    const id = String(r.GAME_ID);
    const cur = map.get(id) || {gameId:id,date:r.GAME_DATE,season:r.SEASON_ID,stage:null,teams:[]};
    cur.teams.push(r);
    map.set(id,cur);
  }
  return [...map.values()].map(g=>{
    const a = g.teams.find(x=>String(x.MATCHUP||"").includes(" @ ")) || g.teams[0];
    const h = g.teams.find(x=>String(x.MATCHUP||"").includes(" vs. ")) || g.teams.find(x=>x!==a) || g.teams[1];
    const away = a && String(a.MATCHUP).includes(" @ ") ? a : h;
    const home = a && String(a.MATCHUP).includes(" @ ") ? h : a;
    return {gameId:g.gameId,date:g.date,season:g.season,away:{name:away?.TEAM_NAME,abbreviation:away?.TEAM_ABBREVIATION,score:away?.PTS,record:""},home:{name:home?.TEAM_NAME,abbreviation:home?.TEAM_ABBREVIATION,score:home?.PTS,record:""},status:"Final"};
  }).sort((x,y)=>String(x.date).localeCompare(String(y.date)));
}
app.get("/api/health", (_req,res)=>res.json({ok:true,source:"NBA Stats API",time:new Date().toISOString()}));
app.get("/api/schedule", async (req,res)=>{
  const sport=String(req.query.sport||"nba").toLowerCase(), season=String(req.query.season||"2016-17"), stage=String(req.query.stage||"Regular Season"), date=String(req.query.date||"");
  if(sport!=="nba") return res.status(501).json({error:`${sport.toUpperCase()} is not connected yet. Configure a provider for this sport instead of displaying invented games.`});
  if(!seasonOk(season)) return res.status(400).json({error:"Invalid season."});
  const key=`schedule:${season}:${stage}`;
  try {
    let games=cached(key,TTL.schedule);
    if(!games){
      const raw=await nba("leaguegamelog",{Counter:0,DateFrom:"",DateTo:"",Direction:"ASC",LeagueID:"00",PlayerOrTeam:"T",Season:season,SeasonType:stage,Sorter:"DATE"});
      games=put(key,normalizeGameRows(rows(dataset(raw,"LeagueGameLog"))));
    }
    const filtered=date?games.filter(g=>String(g.date).slice(0,10)===date):games;
    res.json({sport,season,stage,count:filtered.length,games:filtered});
  } catch(e) { res.status(502).json({error:`Sports data request failed: ${e.message}`}); }
});
app.get("/api/games/:id", async (req,res)=>{
  const id=String(req.params.id); if(!/^\d{10}$/.test(id)) return res.status(400).json({error:"Invalid NBA game ID."});
  const key=`game:${id}`;
  try {
    const hit=cached(key,TTL.game); if(hit)return res.json(hit);
    const [summary,pbp,box]=await Promise.all([
      nba("boxscoresummaryv2",{GameID:id}),
      nba("playbyplayv2",{GameID:id,StartPeriod:1,EndPeriod:10}),
      nba("boxscoretraditionalv3",{GameID:id,EndPeriod:10,EndRange:0,RangeType:0,StartPeriod:1,StartRange:0}).catch(()=>null)
    ]);
    const gh=rows(dataset(summary,"GameHeader"))[0]||{};
    const ls=rows(dataset(summary,"LineScore"));
    const awayLS=ls.find(x=>String(x.TEAM_ID)===String(gh.VISITOR_TEAM_ID))||{};
    const homeLS=ls.find(x=>String(x.TEAM_ID)===String(gh.HOME_TEAM_ID))||{};
    const games=dataset(pbp,"PlayByPlay");
    const plays=rows(games).map(r=>({event:r.EVENTNUM,period:r.PERIOD,clock:r.PCTIMESTRING,teamTricode:String(r.HOMEDESCRIPTION||"").trim()?homeLS.TEAM_ABBREVIATION:awayLS.TEAM_ABBREVIATION,description:String(r.HOMEDESCRIPTION||r.VISITORDESCRIPTION||r.NEUTRALDESCRIPTION||"").trim(),score:r.SCORE||""})).filter(p=>p.description||p.score);
    let players=[];const bs=box?.boxScoreTraditional;if(bs){for(const t of [bs.awayTeam,bs.homeTeam]) for(const p of (t?.players||[])){const s=p.statistics||{};players.push({name:p.nameI||`${p.firstName||""} ${p.familyName||""}`.trim(),team:t.teamTricode,min:s.minutes,pts:s.points,reb:s.reboundsTotal,ast:s.assists,stl:s.steals,blk:s.blocks})}}
    const result={gameId:id,date:gh.GAME_DATE_EST,season:gh.SEASON||"",stage:"",status:gh.GAME_STATUS_TEXT||"Final",clock:gh.LIVE_PC_TIME||"",arena:gh.NATL_TV_BROADCASTER_ABBREVIATION||"",away:{name:awayLS.TEAM_NAME,abbreviation:awayLS.TEAM_ABBREVIATION,score:awayLS.PTS},home:{name:homeLS.TEAM_NAME,abbreviation:homeLS.TEAM_ABBREVIATION,score:homeLS.PTS},plays,boxScore:{players}};
    res.json(put(key,result));
  } catch(e) { res.status(502).json({error:`Game data request failed: ${e.message}`}); }
});
app.use((_req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`Playrush running at http://localhost:${PORT}`));
