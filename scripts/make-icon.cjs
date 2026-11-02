const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
const size=64,raw=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const dx=Math.abs(x-31.5),dy=Math.abs(y-31.5);const hex=dx<27&&dy<29&&dy+dx*.58<38;
 const h=(x>=21&&x<=26||x>=37&&x<=42)&&y>=20&&y<=44||x>=25&&x<=38&&y>=29&&y<=35;
 const p=y*(size*4+1)+1+x*4;raw.set(hex?(h?[11,38,37,255]:[104,225,208,255]):[0,0,0,0],p);
}
const hdr=Buffer.alloc(13);hdr.writeUInt32BE(size,0);hdr.writeUInt32BE(size,4);hdr[8]=8;hdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const dir=path.resolve(__dirname,'../assets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'icon.png'),png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=size;ico[7]=size;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(dir,'icon.ico'),Buffer.concat([ico,png]));
