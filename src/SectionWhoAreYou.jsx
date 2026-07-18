import React from "react";
import { fm } from "./theme";
import { FocusModeShell, Sidebar, TopBar, Card, Eyebrow, Button,
        VerdictBadge, StatTile, ProgressBar, TaskRow } from "./components";

// This component would contain the content from the original "WHO ARE YOU?" section
// Adapted to receive props for navigation and profile opening
export default function SectionWhoAreYou({ onNavigate, onOpenProfile }) {
  // In a real implementation, this would contain the JSX from lines ~3191-3212
  // of the original App.jsx file, adapted to use the passed-in props

  return (
    <section data-sec="s1" style={{minHeight:"70vh",position:"relative",zIndex:2,display:"flex",flexDirection:"column",justifyContent:"center",padding:"clamp(40px,6vh,70px) clamp(24px,6vw,90px)"}}>
      <div style={{maxWidth:680}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontWeight:400,fontSize:9,letterSpacing:"0.44em",color:"#6a5820",textTransform:"uppercase",marginBottom:20,opacity:1,transform:"translateX(0)",transition:"opacity .5s,transform .5s"}}>SUBJECT ANALYSIS</div>
        <div style={{width:"100%",height:1,background:"#3a2800",marginBottom:44,position:"relative",overflow:"hidden",opacity:1,transition:"opacity .3s .1s"}}/>
        <h2 style={{fontFamily:"'Orbitron',sans-serif",fontSize:clamp(27px,5.4vw,40px),lineHeight:1.18,letterSpacing:1px,color:"#fff6ea",margin:0}}>
          WHO ARE YOU?
        </h2>
        <div style={{maxWidth:"56ch"}}>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#8a7040",marginTop:0,marginBottom:0,textAlign:"left",opacity:1,transform:"translateY(0)",transition:"opacity .5s 0ms,transform .5s 0ms"}}>
            You reach for your phone before you're out of bed.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#8a7040",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transform:"translateY(0)",transition:"opacity .5s 65ms,transform .5s 65ms"}}>
            You can't finish a thought without an interruption.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#8a7040",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transform:"translateY(0)",transition:"opacity .5s 130ms,transform .5s 130ms"}}>
            You scroll not to find something —
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#8a7040",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transform:"translateY(0)",transition:"opacity .5s 195ms,transform .5s 195ms"}}>
            to feel something.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#f5a000",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transition:"opacity .5s 260ms,transform .5s 260ms"}}>
            Your dopamine system has been hijacked.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#6a5820",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transition:"opacity .5s 340ms,transform .5s 340ms"}}>
            This is not a willpower problem.
          </p>
          <p style={{fontFamily:"'Inter',sans-serif",fontWeight:400,fontSize:15,letterSpacing:"0.01em",lineHeight:1.82,color:"#6a5820",marginTop:18,marginBottom:0,textAlign:"left",opacity:1,transition:"opacity .5s 405ms,transform .5s 405ms"}}>
            This is neuroscience.
          </p>
        </div>
      </div>
    </section>
  );
}