const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),errors=[];
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/];
const exampleIds=new Set(['012345678901234567890123','012345678901234567890124','012345678901234567890125']);
for(const name of files){
 if(/(^|\/)(node_modules|dist|vendor|outputs|\.env|credentials|secrets)(\/|$)/.test(name)||name.startsWith('work/')&&!name.startsWith('work/aerodesk/')||/^work\/aerodesk\/check-/.test(name))errors.push(name+': local/generated file is tracked');
 const bytes=fs.readFileSync(path.join(root,name));if(bytes.length>10*1024*1024)errors.push(name+': file exceeds the source-repository size limit');
 if(bytes.includes(0))continue;const text=bytes.toString('utf8');
 if(secretPatterns.some(pattern=>pattern.test(text)))errors.push(name+': possible credential/private key (value withheld)');
 if(/[A-Z]:[/\\]+Users[/\\]+(?!example\b|Public\b)[^/\\\s'"<>]+[/\\]/i.test(text))errors.push(name+': personal Windows path');
 for(const match of text.matchAll(/https:\/\/cad\.onshape\.com\/documents\/([a-f\d]{24})/g))if(!exampleIds.has(match[1]))errors.push(name+': personal CAD document reference');
}
for(const required of ['README.md','LICENSE','.gitignore','work/aerodesk/package-lock.json','work/aerodesk/licenses/OCCT_LGPL_EXCEPTION.txt'])if(!files.includes(required))errors.push(required+': missing from source tree');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Repository check passed: '+files.length+' source files; no generated artifacts or matched credentials/personal paths. Pattern scanning is not a complete secret audit.');
