import type React from 'react';
import { ComponentType, ReactNode } from 'react';

type ProviderEntry = [ComponentType<{ children: ReactNode }>, Record<string, unknown>?];
type WrapperComponent = ({ children }: { children: ReactNode }) => React.JSX.Element;

export const buildProvidersTree = (componentsWithProps: ProviderEntry[]): WrapperComponent => {
  const initialComponent = ({ children }: { children: ReactNode }) => <>{children}</>;

  return componentsWithProps.reduce(
    (AccumulatedComponents: WrapperComponent, [Provider, props = {}]: ProviderEntry) => {
      return ({ children }: { children: ReactNode }) => (
        <AccumulatedComponents>
          <Provider {...props}>{children}</Provider>
        </AccumulatedComponents>
      );
    },
    initialComponent
  );
};
