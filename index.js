import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { google } from "googleapis";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

/* ======================= DATABASE ======================= */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✔ MongoDB Connected"))
.catch(err=>console.log("❌ DB Error",err));

const Video = mongoose.model("Video", new mongoose.Schema({
    url: String,
    file: String,
    status:{type:String, default:"pending"}, // pending → downloaded → uploaded
    uploadedAt: Date
}));


/* =================== DOWNLOAD WITHOUT YT-DLP ==================== */

async function downloadVideo(video){
    console.log("📥 Fetching MP4 link →", video.url);

    const apiURL = `https://api.savetube.me/download?url=${encodeURIComponent(video.url)}`;
    const res = await fetch(apiURL).then(r=>r.json()).catch(()=>null);

    if(!res || !res.video || !res.video.url){
        console.log("❌ FAILED to extract download link");
        video.status="failed";
        await video.save();
        return null;
    }

    const mp4 = res.video.url;
    console.log("🔗 Download URL:", mp4);

    const fileName = `video_${video._id}.mp4`;
    const filePath = path.join(process.cwd(), fileName);

    const buff = Buffer.from(await (await fetch(mp4)).arrayBuffer());
    fs.writeFileSync(filePath,buff);

    console.log("✔ Saved:", fileName);

    video.file = filePath;
    video.status="downloaded";
    await video.save();
    return filePath;
}


/* ======================== UPLOAD TO YT ======================== */

async function upload(video){
    if(!fs.existsSync(video.file)) return console.log("❌ FILE missing",video.file);

    console.log("🚀 Uploading to YouTube...");

    const auth = new google.auth.OAuth2(
        process.env.YT_CLIENT_ID,
        process.env.YT_CLIENT_SECRET
    );
    auth.setCredentials({refresh_token:process.env.YT_REFRESH_TOKEN});

    const yt = google.youtube({version:"v3",auth});

    await yt.videos.insert({
        part:"snippet,status",
        requestBody:{
            snippet:{
                title:`🔥 Auto Uploaded Short #${Date.now()} #shorts`,
                categoryId:"28"
            },
            status:{privacyStatus:"public"}
        },
        media:{body:fs.createReadStream(video.file)}
    });

    video.status="uploaded";
    video.uploadedAt=Date.now();
    await video.save();
    fs.unlinkSync(video.file);

    console.log("🔥 UPLOAD SUCCESS + FILE CLEANED");
}


/* ===================== FORCE UPLOAD NEXT ===================== */

app.get("/force-upload", async(req,res)=>{
    const v = await Video.findOne({status:"pending"});
    if(!v) return res.send("🚫 No pending videos");

    console.log("\n-------- 🚀 FORCE-UPLOAD STARTED --------");

    const file = await downloadVideo(v);
    if(file) await upload(v);

    return res.send("✔ Processed — SEE LOGS");
});


/* ====================== ADD SINGLE URL ======================= */

app.post("/api/add",async(req,res)=>{
    await Video.create({url:req.body.url});
    res.json({added:true,url:req.body.url});
});


/* ========================== ADMIN UI ========================= */

app.get("/admin",(req,res)=>{
    res.sendFile(path.join(process.cwd(),"admin.html"));
});


/* =========================== SERVER ========================== */

app.listen(10000,()=>console.log("🚀 BOT LIVE — Ready to Upload Shorts"));
