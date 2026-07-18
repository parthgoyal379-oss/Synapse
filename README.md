# SYNAPSE - AI Habit Tracker for Dopamine Recovery

> AI habit tracker for dopamine recovery. Reset your brain, rewire habits with SYNAPSE. Overcome addictions using science-backed tools and tracking.

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [SEO Optimization](#seo-optimization)
- [Contact](#contact)
- [Acknowledgments](#acknowledgments)

## Overview

SYNAPSE is an AI-powered recovery platform designed to help people overcome compulsive digital habits such as pornography, doomscrolling, social media addiction, gaming, and other dopamine-driven behaviors. Unlike generic AI chatbots, SYNAPSE is built specifically for behavior change - it creates personalized recovery protocols, adapts after relapses, analyzes patterns, and provides structured daily check-ins for accountability.

The platform combines personalized coaching, daily accountability, and adaptive recovery plans to help users build healthier habits one day at a time. It focuses on understanding why users relapse and continuously adjusts recovery strategies based on behavior, recognizing that recovery is personalized—not one-size-fits-all.

## Features

- **Personalized Recovery Protocol**: Starts with a short assessment about your habits and challenges, then generates a customized recovery plan tailored to your goals, behavior, and triggers
- **AI-Powered Daily Check-ins**: Daily check-ins to record progress, urges, wins, setbacks, and mindset, helping the AI understand your recovery journey and provide more relevant guidance over time
- **Adaptive Learning**: As your behavior changes, the AI continuously refines your protocol instead of keeping you on a fixed routine
- **Relapse Support**: Helps you analyze what happened during relapses, identify triggers, and update your recovery plan to reduce chances of repeating patterns
- **Multi-Habit Support**: Designed for behavioral addictions driven by unhealthy dopamine-seeking patterns, including social media, doomscrolling, gaming, binge-watching, and similar compulsive habits
- **Progress Tracking**: Recovery Levels mark important milestones in your journey—unlock higher levels as you remain consistent and build healthier habits
- **Privacy First**: Your recovery data is securely stored and used only to personalize your experience; information is never shared or sold
- **Cross-Platform**: Built as a Progressive Web App (PWA), allowing installation and use on desktop, Android, and iPhone without downloading from an app store
- **Free Access**: Offers a free experience with optional premium features that unlock more advanced AI coaching and recovery tools
- **SEO Optimized**: Implements Schema.org structured data (FAQPage, HowTo) for enhanced search visibility and rich snippets

## Technology Stack

- **Frontend**: React.js with JavaScript
- **Styling**: CSS with custom fonts (Orbitron, Inter, JetBrains Mono, Space Mono, Space Grotesk)
- **Icons**: Custom SVG/PNG icons
- **Manifest**: Web App Manifest for PWA functionality
- **SEO**: Schema.org structured data (FAQPage, HowTo, Organization, Person, WebSite, WebApplication)
- **Analytics**: Google TagManager integration
- **Fonts**: Google Fonts integration
- **Build Tool**: Vite (inferred from project structure)
- **Deployment**: Vercel

## Installation

Since SYNAPSE is designed as a Progressive Web App, there's no traditional installation process for end users. However, for development purposes:

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```bash
   cd synapse
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   ```

## Usage

1. Visit the application at https://www.synapserewire.site/
2. Complete the initial assessment about your habits and challenges
3. Receive your personalized recovery protocol
4. Check in daily with your AI coach to track progress
5. Monitor your improvement through Recovery Levels and habit tracking
6. Adjust your plan as needed based on insights and patterns identified by the AI

## Project Structure

```
synapse/
├── public/                 # Static assets
│   ├── favicon.svg         # Favicon
│   ├── icon-192.png        # App icon (192x192)
│   ├── icon-512.png        # App icon (512x512)
│   ├── og-image.png        # Open Graph image for social sharing
│   └── quit/               # Quit guide articles with SEO schema markup
│       ├── doomscrolling/
│       ├── gambling/
│       ├── gaming/
│       ├── junk-food/
│       ├── porn/
│       ├── reels/
│       └── social-media/
├── src/                    # Source code
│   ├── App.jsx             # Main React component
│   ├── main.jsx            # Entry point
│   └── focus-mode/         # Focus mode component
├── index.html              # Main HTML document with SEO metadata
├── vercel.json             # Vercel deployment configuration
└── README.md               # This file
```

## SEO Optimization

As part of the SEO enhancement initiative, the following improvements have been implemented:

### Structured Data Implementation
- **FAQPage Schema**: Added to `index.html` with 15 Q&A pairs covering SYNAPSE features, functionality, privacy, pricing, and usage
- **HowTo Schema**: Added to all quit guide pages:
  - How to Stop Watching Reels
  - How to Stop Watching Porn (with corrected text in step 4)
  - How to Stop Compulsive Gaming
  - How to Quit Social Media
  - How to Stop Eating Junk Food
  - How to Stop Doomscrolling
  - How to Stop Gambling

Each HowTo schema includes:
- Proper `@context` and `@type` declarations
- Descriptive name and description
- Relevant image URL
- Estimated cost (set to $0)
- Time to complete (in ISO 8601 format)
- Detailed step-by-step instructions
- Required tools/resources

### Content Improvements
- Fixed corrupted text in the porn addiction guide's Step 4
- Corrected UTF-8 encoding issues across multiple HTML files
- Added alt text to user avatar images for accessibility and SEO
- Ensured proper canonical tags and Open Graph metadata

### Technical SEO
- Valid JSON-LD implementation for all structured data
- Proper schema types following schema.org guidelines
- Enhanced search engine understanding of content
- Improved potential for rich snippets in search results

## Contact

- **Parth Goyal** - Co-Founder & CEO - [https://www.synapserewire.site/#parth-goyal](https://www.synapserewire.site/#parth-goyal)
- **Sandali Tiwari** - Co-Founder & COO - [https://www.synapserewire.site/#sandali-tiwari](https://www.synapserewire.site/#sandali-tiwari)

Project Link: [https://www.synapserewire.site/](https://www.synapserewire.site/)

## Acknowledgments

- Built with React and modern web technologies
- Inspired by behavioral psychology and addiction recovery research
- Utilizes schema.org structured data for enhanced search visibility
- Designed as a Progressive Web App for universal accessibility

---
*Copyright © 2026 SYNAPSE. All rights reserved.*