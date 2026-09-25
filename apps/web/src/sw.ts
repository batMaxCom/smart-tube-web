import { useEffect, useRef, useState } from 'react';
import { useApp } from './store';

/**
 * Подписка на автообновление Progressive Web App.
 * Service worker сам обновляется (skipWaiting + clients.claim);
 * здесь мы перезагружаем страницу, когда новое обновление вступает в силу.
 * На странице плеера вместо резкой перезагрузки показываем баннер-кнопку.
 */
export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const routeName = useApp((s) => s.route.name);
  const hadUpdate = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true;
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (!active) return;
        if (reg.waiting && navigator.serviceWorker.controller) {
          hadUpdate.current = true;
          setUpdateAvailable(true);
        }
        const onFound = () => {
          const w = reg.installing ?? reg.waiting;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              hadUpdate.current = true;
              setUpdateAvailable(true);
            }
          });
        };
        reg.addEventListener('updatefound', onFound);
      })
      .catch(() => {
        /* dev-оверлей/неподдерживаемый контекст — молча пропускаем */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onControl = () => {
      // автообновление: перезагружаем, если обновление реально применилось;
      // не мешаем воспроизведению на странице плеера — там пользователь сам нажмёт кнопку
      if (hadUpdate.current && routeName !== 'watch') window.location.reload();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControl);
    return () => navigator.serviceWorker?.removeEventListener('controllerchange', onControl);
  }, [routeName]);

  const applyUpdate = () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => window.location.reload(), 120);
  };

  return { updateAvailable, applyUpdate };
}