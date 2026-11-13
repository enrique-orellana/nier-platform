import React, { useCallback, useEffect, useMemo, useState } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { PanelLeft } from "lucide-react";
import { cn } from "../../lib/utils";
import { SidebarContext, useSidebar } from "./sidebar-context";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "4.5rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
  ...props
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const open = openProp ?? internalOpen;

  const setOpen = useCallback(
    (value) => {
      const nextOpen = typeof value === "function" ? value(open) : value;
      if (openProp === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open, openProp],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile((current) => !current);
    else setOpen((current) => !current);
  }, [isMobile, setOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateMobile = () => setIsMobile(mediaQuery.matches);
    updateMobile();
    mediaQuery.addEventListener("change", updateMobile);
    return () => mediaQuery.removeEventListener("change", updateMobile);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";
  const contextValue = useMemo(
    () => ({
      state,
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, openMobile, isMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={{
          "--sidebar-width": SIDEBAR_WIDTH,
          "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
          ...style,
        }}
        className={cn(
          "group/sidebar-wrapper flex h-screen min-h-0 w-full overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = "left",
  collapsible = "icon",
  className,
  children,
  ...props
}) {
  const { isMobile, state, open, openMobile, setOpenMobile } = useSidebar();
  const sidebarWidth = open ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_ICON;

  if (collapsible === "none") {
    return (
      <aside
        data-slot="sidebar"
        className={cn("flex h-full shrink-0 flex-col bg-surface", className)}
        style={{ width: SIDEBAR_WIDTH }}
        {...props}
      >
        {children}
      </aside>
    );
  }

  if (isMobile) {
    const sidePosition =
      side === "right"
        ? "!left-auto !right-0 !border-l !border-r-0"
        : "!left-0 !right-auto !border-l-0 !border-r";
    return (
      <Dialog open={openMobile} onOpenChange={setOpenMobile}>
        <DialogContent
          showClose={false}
          className={cn(
            "!fixed !inset-y-0 !top-0 !h-screen !w-[min(18rem,calc(100vw-2rem))] !max-w-none !translate-x-0 !translate-y-0 !block !rounded-none !border-y-0 !border-white/10 !bg-surface !p-0 !shadow-2xl",
            sidePosition,
            className,
          )}
        >
          <DialogTitle className="sr-only">OpenShorts navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate between OpenShorts sections.
          </DialogDescription>
          <div className="flex h-full flex-col">{children}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-side={side}
      className="group peer hidden h-full shrink-0 md:block"
      {...props}
    >
      <div
        data-slot="sidebar-gap"
        className="h-full transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarWidth }}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-20 hidden h-screen transition-[width] duration-300 ease-in-out md:flex",
          side === "right" ? "right-0" : "left-0",
          className,
        )}
        style={{ width: sidebarWidth }}
      >
        <aside
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col border-r border-white/5 bg-surface text-white group-data-[side=right]:border-r-0 group-data-[side=right]:border-l"
        >
          {children}
        </aside>
      </div>
    </div>
  );
}

function SidebarHeader({ className, ...props }) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

function SidebarMenuButton({
  render,
  isActive = false,
  size = "default",
  className,
  ...props
}) {
  const { state } = useSidebar();
  return useRender({
    defaultTagName: "button",
    props: mergeProps(
      {
        type: "button",
        className: cn(
          "peer/menu-button group/menu-button flex h-11 w-full items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0",
          state === "collapsed" && "justify-center px-0",
          size === "sm" && "h-8",
          size === "lg" && "h-12",
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  });
}

function SidebarTrigger({ className, onClick, children, ...props }) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "size-8 rounded-lg text-zinc-500 hover:text-white",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      {children ?? <PanelLeft className="size-4" />}
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
}

function SidebarInset({ className, ...props }) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-w-0 w-full flex-1 flex-col", className)}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
};
