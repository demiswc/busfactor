/** The two-minute walkthrough. Hosted on this site (no YouTube tracking); the player's own button makes it full screen. */
export function WalkthroughVideo({ className = '' }: { className?: string }) {
  return (
    <video controls preload="none" playsInline poster="/media/busfactor-walkthrough-poster.webp" style={{ aspectRatio: "16 / 9", height: "auto", background: "#000" }}
      className={`block aspect-video h-auto w-full bg-black object-contain ${className}`}>
      <source src="/media/busfactor-walkthrough.mp4" type="video/mp4" />
      <source src="/media/busfactor-walkthrough.webm" type="video/webm" />
      Your browser cannot play this video. <a href="/media/busfactor-walkthrough.mp4">Download it instead</a>.
    </video>
  )
}
