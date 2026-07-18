import React from "react";
import { fm } from "./theme";
import { ChevronDown } from "lucide-react";

// This component contains the content from the original "FAQ" section
export default function FAQSection({ faqOpen, setFaqOpen }) {
  const faqData = [
    ["Why use SYNAPSE instead of ChatGPT or other AI chatbots?","Most AI chatbots answer questions. SYNAPSE is built to change behavior. Instead of starting from scratch every conversation, it creates a personalized recovery protocol, remembers your progress, adapts after relapses, analyzes patterns, and keeps you accountable through structured daily check-ins. It's not just an AI conversation — it's an AI-powered recovery system."],
    ["What is SYNAPSE?","SYNAPSE is an AI-powered recovery platform designed to help people overcome compulsive digital habits such as pornography, doomscrolling, social media addiction, gaming, and other dopamine-driven behaviors. Using personalized coaching, daily accountability, and adaptive recovery plans, SYNAPSE helps you build healthier habits one day at a time."],
    ["How does SYNAPSE work?","Start by completing a short assessment about your habits and challenges. SYNAPSE then generates a recovery protocol tailored to your goals, behavior, and triggers. Every day, you check in with your AI coach, track your progress, and receive guidance that evolves with your journey."],
    ["What makes SYNAPSE different?","Most habit trackers count streaks. SYNAPSE focuses on understanding why you relapse and continuously adjusts your recovery strategy based on your behavior. Recovery is personalized — not one-size-fits-all."],
    ["What happens if I relapse?","Relapse doesn't erase your progress. SYNAPSE helps you analyze what happened, identify triggers, and update your recovery plan to reduce the chances of repeating the same pattern. The goal is long-term improvement — not perfection."],
    ["How does the AI create my recovery plan?","Your recovery plan is generated using the information you provide during onboarding along with your ongoing check-ins. As your behavior changes, the AI continuously refines your protocol instead of keeping you on a fixed routine."],
    ["How do daily check-ins work?","Each day you'll complete a quick check-in to record your progress, urges, wins, setbacks, and mindset. Your responses help the AI understand your recovery journey and provide more relevant guidance over time."],
    ["Can SYNAPSE help with more than porn addiction?","Yes. SYNAPSE is designed for behavioral addictions driven by unhealthy dopamine-seeking patterns, including social media, doomscrolling, gaming, binge-watching, and similar compulsive habits."],
    ["Does SYNAPSE replace therapy?","No. SYNAPSE is a self-improvement and accountability tool, not a replacement for licensed mental health care. If you're experiencing serious mental health concerns, professional support is recommended."],
    ["Is my data private?","Yes. Your recovery data is securely stored and used only to personalize your experience. Your information is never shared or sold."],
    ["Is SYNAPSE free?","SYNAPSE offers a free experience with optional premium features that unlock more advanced AI coaching and recovery tools."],
    ["Can I use SYNAPSE on my phone?","Yes. SYNAPSE is built as a Progressive Web App (PWA), allowing you to install and use it on desktop, Android, and iPhone without downloading it from an app store."],
    ["How long does recovery take?","Recovery looks different for everyone. Some users notice improvements within weeks, while lasting behavioral change often requires consistent effort over several months. SYNAPSE is designed to support long-term progress, not quick fixes."],
    ["What are Recovery Levels?","Recovery Levels mark important milestones in your journey. As you remain consistent and build healthier habits, you'll unlock higher levels that reflect your long-term progress — not just your current streak."],
    ["Why doesn't SYNAPSE focus only on streaks?","A streak doesn't explain your behavior. SYNAPSE looks beyond the number of days and focuses on patterns, triggers, consistency, and sustainable recovery. The objective isn't to chase the longest streak — it's to build lasting change."],
  ];

  return (
    <section data-sec="faq" style={{position:"relative",zIndex:2,padding:"clamp(50px,7vh,90px) clamp(24px,6vw,90px) clamp(80px,10vh,120px)"}}>
      <div style={{maxWidth:760,width:"100%",margin:"0 auto"}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontWeight:600,fontSize:22,letterSpacing:"0.25em",color:"#c9962e",textTransform:"uppercase",marginBottom:24,textAlign:"center"}}>FAQ</div>
        <div style={{width:"100%",height:1,background:"#3a2800",marginBottom:44}}/>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {faqData.map(([q,a],i)=>(
            <div key={i} style={{background:"rgba(255,140,0,0.02)",border:"1px solid rgba(255,140,0,0.10)",borderColor:faqOpen===i?"rgba(255,140,0,0.28)":"rgba(255,140,0,0.10)",borderRadius:16,overflow:"hidden",transition:"border-color .3s"}}>
              <button
                onClick={()=>setFaqOpen(faqOpen===i?null:i)}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,padding:"18px clamp(18px,3vw,26px)",background:"transparent",border:"none",cursor:"pointer",textAlign:"left"}}
              >
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,fontSize:"clamp(15px,2vw,19px)",color:faqOpen===i?"#f5a000":"var(--text)",lineHeight:1.4,transition:"color .3s"}}>{q}</span>
                <span style={{flexShrink:0,color:"#f5a000",transform:faqOpen===i?"rotate(180deg)":"rotate(0deg)",transition:"transform .3s"}}>
                  <ChevronDown size={18}/>
                </span>
              </button>
              <div style={{maxHeight:faqOpen===i?400:0,opacity:faqOpen===i?1:0,transition:"max-height .4s ease, opacity .3s ease"}}>
                <p style={{fontFamily:"'Inter',sans-serif",fontSize:"clamp(14px,1.8vw,17px)",lineHeight:1.7,color:"#b89968",margin:0,padding:"0 clamp(18px,3vw,26px) 22px"}}>{a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}