# Blinky

A Chrome extension that helps screen users reduce eye strain through real-time blink detection.

When people focus on a screen, they blink less often and less completely. Blinky watches your blinks through the webcam, keeps track of an "Ocular Debt" score, and gently nudges you to take a deep blink before your eyes get tired.

## How it works

**1. Personal calibration**
Every person's eyes are different, so a single fixed threshold misreads blinks. Before starting, each user records three eye states (open, closed and squeezed) and a 30 second baseline of their natural blink rate. Blinky builds a personal threshold from this.

**2. The Ocular Debt model**
- After a 60 second grace period, debt slowly builds up while you work (full in about 8 minutes).
- A deep, complete blink repays 40 points, so two or three deep blinks clear it.
- Normal shallow blinks repay very little, because they do not properly refresh the tear film.

**3. Gentle intervention**
When debt passes 80, the page briefly fades for about 2 seconds, repeating every 15 seconds until you repay it with deep blinks.

**4. Data export**
Each session logs blinks, debt over time and alerts, and can be exported as CSV for analysis.

## Results

In a within-subject pilot with four participants (intervention off vs on), the deep blink rate rose from **0.22 to 0.61 per minute**.

## Built with AI

I designed the interaction model, calibration flow and intervention logic, and used **Claude** as an AI coding tool to implement them. My role covered defining requirements, reviewing and debugging the generated code, and testing with real users. A key example: the first version used one fixed blink threshold, which kept misreading blinks across different people. I redesigned the flow around personal calibration to fix this.

## Tech

- JavaScript, Chrome Extension (Manifest V3)
- [ml5.js](https://ml5js.org/) FaceMesh for face and eye landmark detection
- [p5.js](https://p5js.org/) for the calibration interface and visuals
- Eye Aspect Ratio (EAR) for blink detection

## Try it

1. Download this repository (**Code** > **Download ZIP**) and unzip it.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Click the Blinky icon, allow camera access and follow the calibration steps.

Camera data is processed locally in your browser and is never uploaded.

## Author

Haoyue Si, MSc/MA Innovation Design Engineering, Imperial College London & Royal College of Art

- Website: [haoyuesidesign.com](https://haoyuesidesign.com/)
- LinkedIn: [linkedin.com/in/haoyuesi](https://www.linkedin.com/in/haoyuesi)
