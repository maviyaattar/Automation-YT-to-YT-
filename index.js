import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Innertube } from "youtubei.js";
import { google } from "googleapis";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// DB Setup
mongoose.connect(process.env.MONGO_URI).then(()=>console.log("✔ DB Connected"));

// Schema
const Video = mongoose.model("Video", new mongoose.Schema({
    url: String,
    file: String,
    status:{type:String, default:"pending"},
    uploadedAt: Date
}));

// DOWNLOAD WITHOUT YT-DLP 🔥
async function downloadVideo(video){
    console.log("📥 Download =>", video.url);

    const yt = await Innertube.create();
    const id = video.url.split("v=")[1];
    const stream = await yt.download(id,{quality:"720p"});

    const filename = `video_${video._id}.mp4`;
    const filePath = path.join(process.cwd(), filename);

    const file = fs.createWriteStream(filePath);
    stream.pipe(file);

    await new Promise(res=>file.on("finish",res));

    console.log("✔ File Saved:", filename);
    video.file = filePath;
    video.status="downloaded";
    await video.save();

    return filePath;
}

// UPLOAD
async function upload(video){
    if(!video.file || !fs.existsSync(video.file)) return console.log("❌ No file");

    console.log("🚀 Uploading to YouTube...");

    const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID,process.env.YT_CLIENT_SECRET);
    auth.setCredentials({refresh_token:process.env.YT_REFRESH_TOKEN});
    const yt = google.youtube({version:"v3",auth});

    await yt.videos.insert({
        part:"snippet,status",
        requestBody:{
            snippet:{title:`🔥 Auto Short ${Date.now()} #shorts`, categoryId:"28"},
            status:{privacyStatus:"public"}
        },
        media:{body:fs.createReadStream(video.file)}
    });

    video.status="uploaded";
    video.uploadedAt=Date.now();
    video.save();

    fs.unlinkSync(video.file);
    console.log("🔥 Uploaded + Cleaned");
}

// FORCE UPLOAD
app.get("/force-upload", async(req,res)=>{
    const v = await Video.findOne({status:"pending"});
    if(!v) return res.send("No pending videos");

    const file = await downloadVideo(v);
    await upload(v);

    res.send("✔ Upload complete (Check channel)");
});

// Add URL
app.post("/api/add",(req,res)=>{
    Video.create({url:req.body.url});
    res.send("Added ✔");
});

// Admin
app.get("/admin",(req,res)=>res.sendFile(path.join(process.cwd(),"admin.html")));

app.listen(10000,()=>console.log("🚀 BOT LIVE — FREE PLAN COMPATIBLE"));
