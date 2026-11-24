import { HttpError } from "./store";

export const emailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to:string,subject:string,text:string,replyTo?:string) {
  if(!emailEnabled()) throw new HttpError(503,"Email sending is not configured. Copy the message or use your mail app instead.");
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject,text,...(replyTo?{reply_to:replyTo}:{})}),
    signal:AbortSignal.timeout(15_000),
  });
  if(!response.ok) throw new Error(`Email provider returned ${response.status}`);
}
