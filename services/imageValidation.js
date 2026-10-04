"use strict";
const formats={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
function imageFormat(buffer,mime) {
    if(!Buffer.isBuffer(buffer)||buffer.length<12) return null;
    const detected=buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff?"jpg":
        buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"png":
        buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP"?"webp":null;
    return detected&&formats[mime]===detected?detected:null;
}
function maxFileSize(value=process.env.MAX_FILE_SIZE) {
    const limit=Number(value||5242880);
    return Number.isSafeInteger(limit)&&limit>0&&limit<=10485760?limit:5242880;
}
module.exports={imageFormat,maxFileSize};
