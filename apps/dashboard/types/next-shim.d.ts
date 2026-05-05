declare module "next" {
  export interface Metadata {
    title?: string;
    description?: string;
  }
}

declare module "next/link" {
  import { AnchorHTMLAttributes, ReactNode } from "react";

  export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
    children?: ReactNode;
  }

  export default function Link(props: LinkProps): JSX.Element;
}

declare module "next/navigation" {
  export interface AppRouterInstance {
    push(href: string): void;
    replace(href: string): void;
  }

  export function useRouter(): AppRouterInstance;
}
