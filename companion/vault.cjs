'use strict';
const {spawn}=require('node:child_process');
// DPAPI binds the encrypted token to this Windows user. Plaintext travels over stdin, never command arguments.
function protect(value,decrypt=false){
  if(process.platform!=='win32')return Promise.reject(Error('Windows DPAPI is required'));
  const script="$ProgressPreference='SilentlyContinue'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security'); "+(decrypt?
    "$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }":
    "$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); [Console]::Write((ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)))");
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let result='';child.stdout.on('data',x=>result+=x);child.stderr.resume();
    child.on('error',()=>reject(Error('Windows credential encryption unavailable')));
    child.on('close',code=>code===0?resolve(result):reject(Error('Windows credential encryption failed')));
    child.stdin.end(value);
  });
}
module.exports={protect};
