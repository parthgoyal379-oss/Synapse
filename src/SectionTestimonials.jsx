import React from "react";
import { fm } from "./theme";

// This component contains the content from the original "TESTIMONIALS" section
export default function SectionTestimonials() {
  return (
    <section data-sec="testi" style={{position:"relative",zIndex:2,padding:"clamp(50px,7vh,80px) 0"}}>
      <div style={{fontFamily:"'Space Mono',monospace",fontWeight:400,fontSize:9,letterSpacing:"0.44em",color:"#6a5820",textTransform:"uppercase",marginBottom:20,textAlign:"center"}}>REAL RESULTS</div>
      <div style={{width:"min(100%,1160px)",height:1,background:"#3a2800",marginBottom:44,marginLeft:"auto",marginRight:"auto"}}/>
      <div className="testi-viewport">
        <div className="testi-track">
          {[...Array(2)].flatMap(()=>[
            ["As a student, I personally felt a huge difference using Synapse. It has helped me dismantle the habits that I was struggling with for over an year. I've saved a huge amount of time that I'm really really grateful for!","Kanchi","Beta Tester"],
            ["The UI definitely doesn't feel like another boring habit tracker. It actually made me want to come back every day.","Satyam","Beta Tester"],
            ["The conversations felt surprisingly personal. It remembered what I was struggling with and gave practical suggestions that were really helpful for me to be better.","Sanvee","Early User"],
            ["I really liked the fact that it tried to understand why I was procrastinating instead of just telling me to stop.","Kanha","Beta Tester"],
            ["The AI coach is the feature I liked the most along with the battle plan. It builds a proper plan for addicted people which is very useful and necessary.","Aditya","Early User"],
            ["The plan was genuinely helpful and made a real difference in managing my compulsive habits. It also provided a clear roadmap to follow which makes the journey to my goal feel achievable.","Jiya","Early User"],
            ["The website is built impressively. It helped me channelize my time productively. I love using it.","Jyotica","Early User"],
          ]).map(([quote,name,role],i)=>(
            <div key={i} className="testi-card">
              <div style={{color:"#f5a000",fontSize:13,letterSpacing:2,marginBottom:14}}>★★★★★</div>
              <p style={{fontFamily:"'Inter',sans-serif",fontSize:13.5,lineHeight:1.65,color:"#c9a860",margin:"0 0 18px",flex:1}}>&ldquo;{quote}&rdquo;</p>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,#ff9500,#ff5000)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:900,color:"#fff"}}>{name[0]}</div>
                <div>
                  <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:12,fontWeight:600,color:"var(--text)"}}>{name}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:9.5,letterSpacing:"0.06em",color:"#6a5820",textTransform:"uppercase"}}>{role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}