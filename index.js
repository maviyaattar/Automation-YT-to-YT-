////////////////////////////////////////////////////////////
//  YT SHORTS AUTO UPLOADER — FINAL QUEUE ENGINE V1.0     //
////////////////////////////////////////////////////////////

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import ytdlp from "youtube-dl-exec";
import { fileURLToPath } from "url";

// =============== ENV SECRETS (Render Dashboard) ===============
const {
  MONGO_URI,
  YT_CLIENT_ID,
  YT_CLIENT_SECRET,
  YT_REFRESH_TOKEN,
  DAILY_LIMIT
} = process.env;

const UPLOAD_PER_DAY = Number(DAILY_LIMIT || 5);

// =============== APP INITIALIZE ===============
const app = express();
app.use(cors());
app.use(express.json());

console.log("\n🚀 YT Auto Queue Bot Started\n");

// =============== DATABASE CONNECT ===============
mongoose.connect(MONGO_URI)
.then(()=>console.log("✔ MongoDB Connected"))
.catch(e=>console.log("❌ MongoDB Error:",e));

// =============== VIDEO SCHEMA ===============
const Video = mongoose.model(
  "Video",
  new mongoose.Schema({
    url:String,
    title:String,
    file:String,
    status:{
      type:String,
      enum:["pending","downloading","downloaded","uploaded","failed"],
      default:"pending"
    },
    uploadedAt:Date,
    lastError:String
  })
);

// =============== FUNCTIONS ===============

function todayStart(){
  const d=new Date();
  d.setHours(0,0,0,0);
  return d;
}

// ---- DOWNLOAD ----
async function downloadVideo(doc){
  console.log(`\n📥 Downloading → ${doc.url}`);
  const file=`video_${doc._id}.mp4`;

  try{
    await Video.findByIdAndUpdate(doc._id,{status:"downloading"});

    await ytdlp(doc.url,{
      output:file,
      format:"mp4"
    });

    await Video.findByIdAndUpdate(doc._id,{file,status:"downloaded"});
    console.log("✔ Downloaded:",file);
    return file;

  }catch(err){
    console.log("❌ Download Failed:",err.message);
    await Video.findByIdAndUpdate(doc._id,{
      status:"failed",
      lastError:err.message
    });
    return null;
  }
}


// ---- UPLOAD ----
async function uploadVideo(doc){
  console.log(`\n⏫ Uploading → ${doc.url}`);

  if(!doc.file || !fs.existsSync(doc.file)){
    console.log("❌ FILE NOT FOUND — Skipping");
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

  try{
    await yt.videos.insert({
      part:"snippet,status",
      requestBody:{
        snippet:{
          title:`${doc.title||"Auto Upload"} #shorts`,
          description:`Reuploaded from queue → ${doc.url}`,
          categoryId:"28"
        },
        status:{privacyStatus:"public"}
      },
      media:{body:stream}
    });

    fs.unlinkSync(doc.file);
    await Video.findByIdAndUpdate(doc._id,{status:"uploaded",uploadedAt:new Date()});
    console.log("🔥 Uploaded + Cleaned:",doc.file);

  }catch(err){
    console.log("❌ Upload Failed:",err.message);
    await Video.findByIdAndUpdate(doc._id,{
      status:"failed",
      lastError:err.message
    });
  }
}


// ---- MAIN EXECUTION ENGINE ----
async function processNext(){

  const uploadedToday=await Video.countDocuments({
    status:"uploaded",
    uploadedAt:{$gte:todayStart()}
  });

  console.log(`\n📊 Uploaded Today: ${uploadedToday}/${UPLOAD_PER_DAY}`);

  if(uploadedToday>=UPLOAD_PER_DAY){
    console.log("⛔ DAILY LIMIT REACHED");
    return;
  }

  const next=await Video.findOne({
    status:{$in:["pending","downloaded"]}
  }).sort({_id:1});

  if(!next){
    console.log("\n📭 QUEUE EMPTY — Add more URLs");
    return;
  }

  if(next.status==="pending"){
    const file=await downloadVideo(next);
    if(!file) return;
    next.file=file;
  }

  await uploadVideo(next);
}



// =============== CRON AUTO UPLOAD (Every 30 mins) ===============
cron.schedule("*/30 * * * *", async ()=>{
  console.log("\n⏰ CRON TICK — Checking Queue");
  await processNext();
});



// =============== API ROUTES ===============

// SINGLE ADD
app.post("/api/add",async(req,res)=>{
  const {url,title}=req.body;
  if(!url) return res.status(400).json({error:"URL required"});
  const doc=await Video.create({url,title,status:"pending"});
  res.json({added:true,id:doc._id});
});

// BULK ADD
app.post("/api/add-bulk",async(req,res)=>{
  const {urls}=req.body;
  if(!urls||!Array.isArray(urls)||urls.length===0)
    return res.status(400).json({error:"urls[] required"});

  await Video.insertMany(urls.map(u=>({url:u,status:"pending"})));
  res.json({added:urls.length});
});

// LIST QUEUE
app.get("/api/list",async(req,res)=>{
  const list=await Video.find().sort({_id:1});
  res.json(list);
});

// RUN ONE MANUALLY
app.get("/force-upload",async(req,res)=>{
  await processNext();
  res.send("🔥 One video processed (check logs)");
});



// =============== ADMIN PANEL SERVE ===============
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

app.get("/admin",(req,res)=>{
  res.sendFile(path.join(__dirname,"admin.html"));
});



// =============== START SERVER ===============
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`\n🔥 BOT LIVE @ PORT ${PORT}\n`));
