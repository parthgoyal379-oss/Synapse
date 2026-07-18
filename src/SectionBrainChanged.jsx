import React from "react";
import { fm, phaseColor } from "./theme";
import { FocusModeShell, Sidebar, TopBar, Card, Eyebrow, Button,
        VerdictBadge, StatTile, ProgressBar, TaskRow, WeeklySparkline,
        EmptyState } from "./components";

export default function SectionBrainChanged({ onNavigate, onOpenProfile }) {
  // This would contain the content from the original "YOUR BRAIN HAS CHANGED" section
  return (
    <section data-sec="s2" style={{minHeight:"70vh",position:"relative",zIndex:2,display:"flex",flexDirection:"column",justifyContent:"center",padding:"clamp(40px,6vh,70px) clamp(24px,6vw,90px)"}}>
      <div style={{maxWidth:680}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontWeight:400,fontSize:9,letterSpacing:"0.44em",color:"#6a5820",textTransform:"uppercase",marginBottom:20,opacity:1,transform:"translateX(0)",transition:"opacity .5s,transform .5s"}}>NEURAL ASSESSMENT</div>
        <div style={{width:"100%",height:1,background:"#3a2800",marginBottom:44,opacity:1,transition:"opacity .3s .1s"}}/>
        <h2 style={{fontFamily:"'Orbitron',sans-serif",fontSize:21,letterSpacing:0.5,color:"#ffab5e",margin:"40px 0 12px",lineHeight:1.3}}>
          YOUR BRAIN<br/>HAS CHANGED.
        </h2>
        <div style={{maxWidth:"56ch"}}>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#f5a000",marginTop:0,marginBottom:0}}>
            Chronic overstimulation has altered your dopamine baseline threshold.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#8a7040",marginTop:18,marginBottom:0}}>
            Tasks that once felt rewarding now feel impossible.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#f5a000",marginTop:18,marginBottom:0}}>
            The problem isn't you.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#f5a000",marginTop:18,marginBottom:0}}>
            The problem is the loop you're stuck in.
          </p>
        </div>
      </div>
    </section>
  );
}