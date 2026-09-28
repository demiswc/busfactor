/** The two-minute walkthrough. Hosted on this site (no YouTube tracking); the player's own button makes it full screen. */
export function WalkthroughVideo({ className = '' }: { className?: string }) {
  return (
    <video controls preload="none" playsInline poster="/media/busfactor-walkthrough-poster.webp" width={1920} height={1080}
      className={`aspect-video w-full bg-black ${className}`}>
      <source src="/media/busfactor-walkthrough.mp4" type="video/mp4" />
      <source src="/media/busfactor-walkthrough.webm" type="video/webm" />
      Your browser cannot play this video. <a href="/media/busfactor-walkthrough.mp4">Download it instead</a>.
    </video>
  )
}
