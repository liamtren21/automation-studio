export function allowedOrigins(){
 if(process.env.STUDIO_ORIGIN)return[new URL(process.env.STUDIO_ORIGIN).origin];
 const hosts=[process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL].filter((v):v is string=>Boolean(v));
 return hosts.length?hosts.map(h=>new URL("https://"+h).origin):["http://localhost:3211"];
}
export function requestOrigin(req:{url:string;headers:Headers}){
 const allowed=allowedOrigins();for(const value of[req.headers.get("origin"),req.headers.get("referer"),req.url]){
  if(!value)continue;try{const origin=new URL(value).origin;if(allowed.includes(origin))return origin;}catch{/* unknown header */}
 }return allowed[0];
}
