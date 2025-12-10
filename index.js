////////////////////////////////////////////////////
// YT Auto Upload Queue Bot — FINAL v3.0 🔥       //
////////////////////////////////////////////////////

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import ytdlp from "youtube-dl-exec";
import { fileURLToPath } from "url";

// ⚠ Load ENV from Render or Local .env if exists
import dotenv from "dotenv";
dotenv.config();

const {
  MONGO_URI,
  YT_CLIENT_ID,
  YT_CLIENT_SECRET,
  YT_REFRESH_TOKEN,
  DAILY_LIMIT
} = process.env;

const DAILY_UPLOAD = Number(DAILY_LIMIT || 4);

// App Init
const app = express();
app.use(cors());
app.use(express.json());
console.log("\n🚀 BOT STARTED\n");

// Mongo Connect
mongoose.connect(MONGO_URI)
.then(()=>console.log("✔ MongoDB Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

// Schema
const Video = mongoose.model("Video", new mongoose.Schema({
  url:String,
  file:String,
  title:String,
  status:{type:String, default:"pending"}, // pending/downloading/downloaded/uploaded/failed
  uploadedAt:Date,
  lastError:String
}));

// Helpers
function today(){
  let d=new Date(); d.setHours(0,0,0,0); return d;
}

// ===================== DOWNLOAD =====================
async function downloadVideo(doc){

  const file = (process.env.RENDER=== "true")
  ? `/opt/render/project/src/video_${doc._id}.mp4`  // Render path
  : `./video_${doc._id}.mp4`;                       // Local PC path

  console.log("📥 Downloading:",doc.url);

  try{
    await Video.findByIdAndUpdate(doc._id,{status:"downloading"});

    await ytdlp(doc.url,{
      output:file,
      format:"mp4"
    });

    await Video.findByIdAndUpdate(doc._id,{file,status:"downloaded"});
    console.log("✔ Downloaded:",file);
    return file;

  }catch(e){
    console.log("❌ Download Failed:",e.message);
    await Video.findByIdAndUpdate(doc._id,{status:"failed",lastError:e.message});
    return null;
  }
}


// ===================== UPLOAD =====================
async function uploadVideo(doc){

  if(!doc.file || !fs.existsSync(doc.file)){
    console.log("❌ FILE NOT FOUND — Listing directory...");
    console.log(fs.readdirSync(process.cwd()));
    return;
  }

  const auth=new google.auth.OAuth2(
    YT_CLIENT_ID,
    YT_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});

  const yt=google.youtube({version:"v3",auth});
  const stream=fs.createReadStream(doc.file);

  console.log("⏫ Uploading:",doc.url);

  try{
    await yt.videos.insert({
      part:"snippet,status",
      requestBody:{
        snippet:{
          title:(doc.title||"Auto Upload")+" #shorts",
          description:`Uploaded via Automation Bot\n${doc.url}`,
          categoryId:"28"
        },
        status:{privacyStatus:"public"}
      },
      media:{body:stream}
    });

    fs.unlinkSync(doc.file);
    await Video.findByIdAndUpdate(doc._id,{status:"uploaded",uploadedAt:new Date()});
    console.log("🔥 UPLOADED + FILE REMOVED\n");

  }catch(e){
    console.log("❌ Upload Error:",e.message);
    await Video.findByIdAndUpdate(doc._id,{status:"failed",lastError:e.message});
  }
}


// ===================== ENGINE =====================
async function processQueue(){

  const done = await Video.countDocuments({status:"uploaded",uploadedAt:{$gte:today()}});
  console.log(`\n📊 Uploaded Today: ${done}/${DAILY_UPLOAD}`);

  if(done>=DAILY_UPLOAD) return console.log("🚫 DAILY LIMIT REACHED");

  let next = await Video.findOne({status:"pending"}) || await Video.findOne({status:"downloaded"});
  if(!next) return console.log("📭 No pending videos");

  if(next.status==="pending"){
    let file = await downloadVideo(next);
    if(!file) return;
  }

  await uploadVideo(next);
}

// Auto every 30 min
cron.schedule("*/30 * * * *",()=>processQueue());

// ===== API =====

app.post("/api/add",async(req,res)=>{
  let doc = await Video.create({url:req.body.url});
  res.json({added:true,id:doc._id});
});

app.post("/api/add-bulk",async(req,res)=>{
  await Video.insertMany(req.body.urls.map(u=>({url:u})));
  res.json({added:req.body.urls.length});
});

app.get("/api/list",async(req,res)=>{
  res.json(await Video.find().sort({_id:1}));
});

app.get("/force-upload",async(req,res)=>{
  processQueue();
  res.send("🔥 Upload Started — Check Logs");
});

// Serve Admin Panel
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

// Start
app.listen(process.env.PORT||3000,()=>console.log("🔥 LIVE",process.env.PORT||3000));
