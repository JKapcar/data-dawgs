const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'datedawg.html');
let html=fs.readFileSync(file,'utf8');const script=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8');
const css=script.match(/style.textContent = `([\s\S]*?)`;/)[1];
fs.writeFileSync(path.join(root,'presentation-mode.css'),css);
html=html.replace(/<script id="dd-presentation-inline">[\s\S]*?<\/script>/,()=>'<script id="dd-presentation-inline">\n'+script+'\n</script>');
html=html.replace(/<style id="dd-presentation-early">[\s\S]*?<\/style>/,()=>'<style id="dd-presentation-early">'+css+'</style>');
fs.writeFileSync(file,html);
