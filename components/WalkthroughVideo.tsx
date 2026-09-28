/**
 * The two-minute walkthrough. Hosted on this site (no YouTube tracking); the player's own button makes it full screen.
 * The player sits inside a fixed 16:9 frame and fills it, so it can never grow to the video's
 * natural 1080px height when it starts playing (some browsers resize a bare <video> on play).
 */
export function WalkthroughVideo({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden bg-black ${className}`} style={{ aspectRatio: '16 / 9' }}>
      <video controls preload="none" playsInline poster="/media/busfactor-walkthrough-poster.webp"
        className="absolute inset-0 h-full w-full object-contain" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none' }}>
        <source src="/media/busfactor-walkthrough.mp4" type="video/mp4" />
        <source src="/media/busfactor-walkthrough.webm" type="video/webm" />
        Your browser cannot play this video. <a href="/media/busfactor-walkthrough.mp4">Download it instead</a>.
      </video>
    </div>
  )
}
