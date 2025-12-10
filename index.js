import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// ================= DB CONNECT ====================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✔ MongoDB Connected"))
.catch(e=>console.log("❌ DB Error", e));

// ============ MODEL ============
const Video = mongoose.model("Video", new mongoose.Schema({
    url: String,
    status:{type:String, default:"pending"},   // pending → downloaded → uploaded
    file: String,
    uploadedAt: Date
}));


// ============ MAIN ENGINE (Download → Upload) ==============
async function processVideo(video){

    console.log("\n📥 Downloading", video.url);
    const filename = `video_${video._id}.mp4`;
    const savePath = path.join(process.cwd(), filename);   // <---- FINAL FIX

    await new Promise(res=>{
        const d = spawn("yt-dlp",["-f","mp4","-o",savePath,video.url]);
        d.stdout.on("data",x=>console.log("▶",x.toString()));
        d.stderr.on("data",x=>console.log("⚠",x.toString()));
        d.on("close",res);
    });

    if(!fs.existsSync(savePath)){
        console.log("❌ DOWNLOAD FAILED:",savePath);
        return;
    }

    console.log("✔ Download saved:",savePath);
    video.file = savePath;
    video.status = "downloaded";
    await video.save();

    console.log("🚀 Uploading to YouTube...");

    // =========== AUTH ==============
    const auth = new google.auth.OAuth2(
        process.env.YT_CLIENT_ID,
        process.env.YT_CLIENT_SECRET
    );
    auth.setCredentials({refresh_token:process.env.YT_REFRESH_TOKEN});
    const yt = google.youtube({version:"v3",auth});

    try{
        await yt.videos.insert({
            part:"snippet,status",
            requestBody:{
                snippet:{
                    title:`Auto Upload 🔥 ${Date.now()} #shorts`,
                    categoryId:"28"
                },
                status:{privacyStatus:"public"}
            },
            media:{ body: fs.createReadStream(savePath) }
        });

        console.log("🔥 UPLOAD SUCCESS");
        video.status="uploaded";
        video.uploadedAt=new Date();
        await video.save();
        fs.unlinkSync(savePath);  // delete after upload
        console.log("🧹 VIDEO FILE DELETED (CLEAN STORAGE)");

    }catch(e){
        console.log("❌ Upload Failed:",e.message);
    }
}


// ==================== ROUTES =====================

// ADD URL
app.post("/api/add", async(req,res)=>{
    let v = await Video.create({url:req.body.url});
    res.json({added:true,id:v._id});
});

// BULK ADD
app.post("/api/add-bulk", async(req,res)=>{
    let list=req.body.urls.map(x=>({url:x}));
    let out = await Video.insertMany(list);
    res.json({added:out.length});
});

// LIST ALL
app.get("/api/list",async(req,res)=> res.json(await Video.find()) );

// FORCE UPLOAD NEXT VIDEO
app.get("/force-upload", async(req,res)=>{
    let next = await Video.findOne({status:"pending"});
    if(!next) return res.send("No pending videos.");

    processVideo(next);
    res.send("Upload started — Check render logs");
});

// ADMIN PAGE
app.get("/admin",(req,res)=> res.sendFile(path.join(process.cwd(),"admin.html")) );

// SERVER
app.listen(10000,()=>console.log("🚀 FINAL BOT ONLINE (Render+Local Supported)"));
