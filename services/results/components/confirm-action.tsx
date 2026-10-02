'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

type Options = { title?: string; confirmLabel?: string; destructive?: boolean };
type Ask = (message: string, options?: Options) => Promise<boolean>;
const Context = createContext<Ask>(() => Promise.resolve(false));

// Explicit in-page confirmation works even where native window.confirm is suppressed.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    ({ message: string } & Options) | null
  >(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((message, options) => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise((done) => {
      resolve.current = done;
      setPending({ message, ...options });
    });
  }, []);
  const finish = useCallback((value: boolean) => {
    const done = resolve.current;
    resolve.current = null;
    setPending(null);
    done?.(value);
  }, []);
  useEffect(
    () => () => {
      resolve.current?.(false);
      resolve.current = null;
    },
    [],
  );
  return (
    <Context.Provider value={ask}>
      {children}
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialogContent className="action-confirm">
          <AlertDialogTitle>{pending?.title ?? '请确认操作'}</AlertDialogTitle>
          <AlertDialogDescription className="action-confirm-description">
            {pending?.message}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={() => finish(true)}
            >
              {pending?.confirmLabel ?? '确认继续'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Context.Provider>
  );
}
export function useConfirm() {
  return useContext(Context);
}
