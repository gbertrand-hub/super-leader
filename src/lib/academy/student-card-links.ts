export function getStudentCardVerificationUrl(token:string){const origin=(process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3002").replace(/\/$/,"");return `${origin}/student/verify/${token}`;}
