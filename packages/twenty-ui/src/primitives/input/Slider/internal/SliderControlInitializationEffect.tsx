import { useLayoutEffect } from 'react';

type SliderControlInitializationEffectProps = {
  control: HTMLDivElement | null;
  onControlInitialized: (control: HTMLDivElement | null) => void;
};

export const SliderControlInitializationEffect = ({
  control,
  onControlInitialized,
}: SliderControlInitializationEffectProps) => {
  useLayoutEffect(() => {
    onControlInitialized(control);
  }, [control, onControlInitialized]);

  return null;
};
