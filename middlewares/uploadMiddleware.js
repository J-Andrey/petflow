"use strict";
const multer=require("multer");
const {cloudinary}=require("../config/cloudinary");
const {imageFormat,maxFileSize}=require("../services/imageValidation");
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxFileSize(),files:1,fields:40,parts:41},
    fileFilter(req,file,callback) {
        if(!["image/jpeg","image/png","image/webp"].includes(file.mimetype))
            return callback(Object.assign(new Error("Use uma imagem JPG, PNG ou WebP."),{status:400}));
        callback(null,true);
    }
});
module.exports={
    single(field) {
        const parse=upload.single(field);
        return (req,res,next)=>parse(req,res,error=>{
            if(error)return next(error);
            if(!req.file)return next();
            const format=imageFormat(req.file.buffer,req.file.mimetype);
            if(!format)return next(Object.assign(new Error("O conteúdo do arquivo não corresponde a uma imagem permitida."),{status:400}));
            const stream=cloudinary.uploader.upload_stream({folder:"petflow",resource_type:"image",
                allowed_formats:["jpg","png","webp"],format,timeout:15000},(uploadError,result)=>{
                if(uploadError)return next(Object.assign(new Error("Não foi possível enviar a imagem."),{status:502}));
                req.file.path=result.secure_url;req.file.filename=result.public_id;delete req.file.buffer;next();
            });
            stream.on("error",()=>{});
            stream.end(req.file.buffer);
        });
    }
};
