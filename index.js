////////////////////////////////////////////////////////////
//   YOUTUBE SHORTS AUTO BOT — RENDER SECURE VERSION     //
////////////////////////////////////////////////////////////

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import cron from "node-cron";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { google } from "googleapis";

// ===== ENV CONFIG (now safe) =====
const {
  MONGO_URI,
  YT_API_KEY,
  YT_CLIENT_ID,
  YT_CLIENT_SECRET,
  YT_REFRESH_TOKEN,
  DAILY_LIMIT
} = process.env;

console.log("\n🚀 Secure Render Bot Started\n");

const app = express();
app.use(cors());
app.use(express.json());

//////////////////// DATABASE ///////////////////
mongoose.connect(MONGO_URI)
.then(()=>console.log("✔ MongoDB Connected Securely"))
.catch(e=>console.log("❌ DB ERROR:",e));

const Video = mongoose.model("Video",new mongoose.Schema({
  title:String,url:String,file:String,
  status:{type:String,default:"pending"},
  uploadedAt:Date
}));

//////////////////// FETCH SHORTS ///////////////////
async function fetchShorts(){
  const API = `
    https://www.googleapis.com/youtube/v3/search
    ?part=snippet&type=video&videoDuration=short&order=viewCount&maxResults=6
    &q=tech+gadgets&key=${YT_API_KEY}
  `.replace(/\s+/g,"");

  const r=await fetch(API),d=await r.json();
  if(!d.items) return console.log("❌ API FAIL");

  d.items.forEach(v=>{
    Video.create({title:v.snippet.title,url:`https://youtube.com/watch?v=${v.id.videoId}`});
    console.log("➕ Added:",v.snippet.title);
  });
}

//////////////////// DOWNLOAD ///////////////////
async function download(v){
  return new Promise(resolve=>{
    const file=`video_${v._id}.mp4`;
    exec(`yt-dlp -f mp4 -o "${file}" "${v.url}"`,async(err)=>{
      if(err){ await Video.findByIdAndUpdate(v._id,{status:"failed"}); return resolve(null); }

      await Video.findByIdAndUpdate(v._id,{file,status:"downloaded"});
      console.log("✔ Downloaded:",file);
      resolve(file);
    });
  });
}

//////////////////// UPLOAD ///////////////////
async function upload(v){
  let fp=`./${v.file}`;
  if(!fs.existsSync(fp)){ console.log("❌ Missing:",v.file); return; }

  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET,"https://developers.google.com/oauthplayground");
  auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:"v3",auth});

  try{
    await yt.videos.insert({
      part:"snippet,status",
      requestBody:{
        snippet:{title:`${v.title} #shorts #tech`,categoryId:"28"},
        status:{privacyStatus:"public"}
      },
      media:{body:fs.createReadStream(fp)}
    });

    console.log("🔥 Uploaded:",v.title);
    fs.unlinkSync(fp);
    await Video.findByIdAndUpdate(v._id,{status:"uploaded",uploadedAt:new Date()});

  }catch(e){ console.log("❌ Upload Error:",e); }
}

//////////////////// CRON AUTO ///////////////////
cron.schedule("*/5 * * * *",async()=>{

  let today=new Date();today.setHours(0,0,0,0);
  let done=await Video.countDocuments({status:"uploaded",uploadedAt:{$gte:today}});
  if(done >= (DAILY_LIMIT||4)) return console.log("⛔ Limit reached");

  let v=await Video.findOne({status:"pending"})||await Video.findOne({status:"downloaded"});
  if(!v) return fetchShorts();

  if(v.status=="pending"){
    let f=await download(v);
    if(!f) return fetchShorts();
  }

  await upload(v);
});

//////////////////// MANUAL UPLOAD ///////////////////
app.get("/force-upload",async(req,res)=>{
  let v=await Video.findOne({status:"pending"})||await Video.findOne({status:"downloaded"});
  if(!v){ await fetchShorts(); return res.send("Shorts Fetched — Click Again"); }
  if(v.status=="pending") await download(v);
  await upload(v);
  res.send("🔥 Forced Upload Triggered — Check Logs");
});

app.listen(3000,()=>console.log("\n🔥 SECURE BOT LIVE\n"));
