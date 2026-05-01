import React from 'react';

export type ConfirmVariant = 'danger' | 'info';

export interface ConfirmDialogOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm?: () => void | Promise<void>;
}

export interface ConfirmDialogState extends Required<Omit<ConfirmDialogOptions, 'onConfirm'>> {
  open: boolean;
  busy: boolean;
}

const defaultState: ConfirmDialogState = {
  open: false,
  busy: false,
  title: '',
  body: '',
  confirmLabel: 'Xác nhận',
  cancelLabel: 'Hủy',
  variant: 'info',
};

export const useConfirmDialog = () => {
  const [state, setState] = React.useState<ConfirmDialogState>(defaultState);
  const actionRef = React.useRef<ConfirmDialogOptions['onConfirm']>(undefined);
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    actionRef.current = options.onConfirm;
    setState({
      open: true,
      busy: false,
      title: options.title,
      body: options.body,
      confirmLabel: options.confirmLabel || 'Xác nhận',
      cancelLabel: options.cancelLabel || 'Hủy',
      variant: options.variant || 'info',
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = React.useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    actionRef.current = undefined;
    setState(defaultState);
  }, []);

  const handleCancel = React.useCallback(() => {
    if (state.busy) return;
    close(false);
  }, [close, state.busy]);

  const handleConfirm = React.useCallback(async () => {
    if (state.busy) return;
    setState(prev => ({ ...prev, busy: true }));
    try {
      await actionRef.current?.();
      close(true);
    } catch (error) {
      console.error('Confirm action failed:', error);
      setState(prev => ({ ...prev, busy: false }));
    }
  }, [close, state.busy]);

  return {
    confirm,
    confirmState: state,
    handleCancel,
    handleConfirm,
  };
};
