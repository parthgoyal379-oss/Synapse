import React from "react";
import { fm } from "./theme";

// This component contains the content from the original "READY TO RECLAIM CONTROL?" section
export default function SectionReadyToReclaim({ onBegin, hasPlan, ctaCharged, ctaFill, handleCtaEnter, handleCtaLeave, s5vis, sbodyStyle }) {
  return (
    <section data-sec="s5" style={{minHeight:"70vh",position:"relative",zIndex:2,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center",padding:"clamp(40px,6vh,70px) clamp(24px,6vw,90px)"}}>
      <div style={{maxWidth:680,width:"100%",textAlign:"center",margin:"0 auto"}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontWeight:400,fontSize:9,letterSpacing:"0.44em",color:"#6a5820",textTransform:"uppercase",marginBottom:20,display:"flex",justifyContent:"center",opacity:s5vis?1:0,transition:"opacity .5s"}}>READY TO RECLAIM CONTROL?</div>
        <div style={{width:"100%",height:1,background:"#3a2800",marginBottom:44,opacity:s5vis?1:0,transition:"opacity .3s .1s"}}/>
        {/* CTA Button */}
        <button
          onMouseEnter={handleCtaEnter}
          onMouseLeave={handleCtaLeave}
          onClick={onBegin}
          style={{
            position:"relative",overflow:"hidden",
            fontFamily:"'Orbitron',sans-serif",fontWeight:700,fontSize:11,
            letterSpacing:"0.45em",textRendering:"geometricPrecision",
            padding:"22px 64px",paddingLeft:"calc(64px + 0.45em)",
            background:"transparent",
            border:`1px solid ${ctaCharged?"#ff5500":"#f5a000"}`,
            color:ctaCharged?"#fff":"#f5a000",
            cursor:"pointer",
            display:"inline-flex",alignItems:"center",justifyContent:"center",
            transition:"border-color .4s,color .4s,box-shadow .4s",
            boxShadow:ctaCharged?"0 0 40px rgba(255,85,0,.35)":"none",
            opacity:s5vis?1:0,transform:s5vis?"translateY(0)":"translateY(16px)",
          }}>
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:ctaFill+"%",background:ctaCharged?"#ff5500":"linear-gradient(90deg,rgba(255,85,0,.08),rgba(255,85,0,.22))",transition:ctaCharged?"none":"none"}}/>
          <span style={{position:"relative",zIndex:1}}>
            {ctaCharged?"BEGIN RESET ›": hasPlan?"RESUME MISSION ›":"INITIALIZE PROTOCOL"}
          </span>
        </button>
        <div style={{fontFamily:"'Space Mono',monospace",fontWeight:400,fontSize:8,letterSpacing:"0.4em",color:"#6a5820",marginTop:28,opacity:s5vis?1:0,transition:"opacity .5s .2s"}}>
          CONFESS &nbsp;·&nbsp; PLAN &nbsp;·&nbsp; RECOVER
        </div>
      </div>
    </section>
  );
}