import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** One observer for page sections; never observes or animates individual song rows. */
export function useInterfaceMotion(content: Ref<HTMLElement | null>, pageKey: () => string) {
  const pageHidden = ref(false)
  const scrolled = ref(false)
  let observer: IntersectionObserver | undefined
  let preference: MediaQueryList | undefined
  const animations = new Set<Animation>()
  const targets = new Set<HTMLElement>()

  function cancelAnimations() {
    animations.forEach(animation => animation.cancel())
    animations.clear()
  }

  function enter(element: HTMLElement, cover = false) {
    if (preference?.matches || pageHidden.value || element.contains(document.activeElement)) return
    const animation = element.animate(
      cover ? [{ opacity: .75 }, { opacity: 1 }] : [{ opacity: .65, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' },
    )
    animations.add(animation)
    animation.onfinish = () => animations.delete(animation)
    animation.oncancel = () => animations.delete(animation)
  }

  function collect() {
    observer?.disconnect()
    targets.forEach(element => element.removeAttribute('data-motion-visible'))
    targets.clear()
    cancelAnimations()
    if (!content.value || !observer || preference?.matches || pageHidden.value) return
    // Section-level entry only: content always remains visible and focusable.
    content.value.querySelectorAll<HTMLElement>('.library-hero, .library-summary, #collection, .library-favorites, .page-heading, .playlist-header, .now-playing, .share-view, .now-cover').forEach(element => {
      targets.add(element)
      observer!.observe(element)
    })
  }

  function visibility() {
    pageHidden.value = document.hidden
    document.documentElement.toggleAttribute('data-motion-paused', document.hidden)
    if (document.hidden) {
      observer?.disconnect()
      cancelAnimations()
    } else collect()
  }

  function scroll() { scrolled.value = window.scrollY > 8 }

  function focus(event: FocusEvent) {
    // Do not let an entry effect soften or displace a newly focused control.
    if (event.target instanceof Node && content.value?.contains(event.target)) cancelAnimations()
  }

  const stop = watch(pageKey, collect, { flush: 'post' })
  onMounted(() => {
    preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if ('IntersectionObserver' in window) observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        if (element.classList.contains('now-cover')) {
          element.toggleAttribute('data-motion-visible', entry.isIntersecting)
        } else if (entry.isIntersecting) {
          enter(element)
          observer?.unobserve(element)
        }
      }
    }, { threshold: 0, rootMargin: '0px 0px -12px 0px' })
    preference.addEventListener('change', collect)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('focusin', focus)
    window.addEventListener('scroll', scroll, { passive: true })
    visibility()
    scroll()
  })
  onBeforeUnmount(() => {
    stop()
    observer?.disconnect()
    cancelAnimations()
    preference?.removeEventListener('change', collect)
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('focusin', focus)
    window.removeEventListener('scroll', scroll)
    document.documentElement.removeAttribute('data-motion-paused')
  })
  return { pageHidden, scrolled }
}
