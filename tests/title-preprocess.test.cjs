const {test}=require('node:test');
const assert=require('node:assert/strict');
const {brightTextBitmap}=require('../src/core/ocr.cjs');

function fixture(background,edge,foreground){
  const pixels=Buffer.alloc(100*4);
  for(let i=0;i<100;i++){const level=i<80?background:i<90?edge:foreground;pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=level;pixels[i*4+3]=255;}
  return pixels;
}
test('bright-text preprocessing adapts to title brightness without changing source pixels',()=>{
  for(const [background,edge,foreground]of [[20,160,240],[40,130,190]]){
    const source=fixture(background,edge,foreground),before=Buffer.from(source),out=brightTextBitmap(source);
    assert.ok(Buffer.isBuffer(out));assert.equal(out.length,source.length);assert.deepEqual(source,before);
    assert.equal(out[0],255);assert.equal(out[80*4],255);assert.equal(out[90*4],0);assert.equal(out[90*4+3],255);
  }
});
test('the second contrast pass preserves weaker strokes while flat or low-contrast images stay unchanged',()=>{
  const source=fixture(20,195,240),fine=brightTextBitmap(source,.86),wide=brightTextBitmap(source,.75);
  assert.equal(fine[80*4],255);assert.equal(wide[80*4],0);
  for(const image of [Buffer.alloc(400,255),fixture(110,120,135),Buffer.alloc(3)])assert.equal(brightTextBitmap(image),null);
});
