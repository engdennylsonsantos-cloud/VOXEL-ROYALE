$file = "frontend\src\style.css"
$lines = Get-Content $file
$clean = $lines | Select-Object -First 540
Set-Content $file $clean -Encoding UTF8

$extra = @"

.inventory-hotbar {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 10px;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

/* Lobby Screen */
.lobby-screen {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  opacity: 0;
  transform: scale(1.04);
  transition: opacity 0.45s ease, transform 0.45s ease;
  pointer-events: none;
}
.lobby-screen--visible {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}
.lobby-screen--launching {
  opacity: 0;
  transform: scale(0.92);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.lobby-screen__backdrop {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(160deg, rgba(4, 11, 28, 0.96), rgba(7, 18, 40, 0.98)),
    radial-gradient(circle at 20% 20%, rgba(34, 211, 238, 0.12), transparent 42%),
    radial-gradient(circle at 80% 80%, rgba(99, 102, 241, 0.14), transparent 38%);
  backdrop-filter: blur(40px);
}
.lobby-screen__content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  width: min(820px, calc(100% - 40px));
  padding: 40px 36px 36px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 30px;
  background: rgba(8, 14, 28, 0.72);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(20px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}
.lobby-screen__header { text-align: center; }
.lobby-screen__eyebrow {
  display: inline-flex;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.12);
  color: #67e8f9;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.lobby-screen__title {
  margin: 10px 0 0;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  letter-spacing: 0.06em;
  color: #f8fafc;
  text-shadow: 0 4px 24px rgba(34, 211, 238, 0.3);
}
.lobby-screen__countdown-wrap {
  position: relative;
  width: 160px;
  height: 160px;
  flex-shrink: 0;
}
.lobby-screen__ring {
  width: 160px;
  height: 160px;
  transform: rotate(-90deg);
}
.lobby-screen__ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.07);
  stroke-width: 8;
}
.lobby-screen__ring-fill {
  fill: none;
  stroke: #22d3ee;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.8s ease;
  filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.7));
}
.lobby-screen__countdown-inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.lobby-screen__countdown-num {
  font-size: 2.8rem;
  font-weight: 900;
  line-height: 1;
  color: #e0f2fe;
  text-shadow: 0 0 24px rgba(34, 211, 238, 0.6);
  letter-spacing: -0.02em;
}
.lobby-screen__countdown-label {
  font-size: 0.76rem;
  color: rgba(148, 163, 184, 0.85);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  max-width: 100px;
  text-align: center;
  line-height: 1.3;
}
.lobby-screen__info { display: flex; align-items: center; gap: 10px; }
.lobby-screen__player-count {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 1.5rem;
  font-weight: 800;
  color: #f8fafc;
}
.lobby-screen__player-sep { color: rgba(148, 163, 184, 0.5); }
.lobby-screen__player-label {
  font-size: 0.9rem;
  font-weight: 400;
  color: rgba(148, 163, 184, 0.75);
  margin-left: 4px;
}
.lobby-screen__roster-wrap { width: 100%; }
.lobby-screen__roster-title {
  margin-bottom: 14px;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.65);
  text-align: center;
}
.lobby-screen__roster {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 600px) {
  .lobby-screen__roster { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.lobby-roster__slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 12px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
}
.lobby-roster__slot--filled {
  border-color: rgba(34, 211, 238, 0.2);
  background: rgba(34, 211, 238, 0.05);
  transform: scale(1.02);
}
.lobby-roster__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #22d3ee, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 900;
  color: #fff;
  box-shadow: 0 4px 14px rgba(34, 211, 238, 0.35);
}
.lobby-roster__avatar--empty {
  background: rgba(255, 255, 255, 0.05);
  border: 2px dashed rgba(255, 255, 255, 0.12);
  box-shadow: none;
}
.lobby-roster__name {
  font-size: 0.76rem;
  color: #e2e8f0;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.lobby-roster__name--empty {
  color: rgba(148, 163, 184, 0.4);
  font-style: italic;
}
.lobby-screen__cancel {
  padding: 12px 28px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(226, 232, 240, 0.7);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, transform 0.16s ease;
}
.lobby-screen__cancel:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  transform: translateY(-1px);
}
"@

Add-Content $file $extra -Encoding UTF8
Write-Host "CSS written OK. Lines: $((Get-Content $file).Count)"
