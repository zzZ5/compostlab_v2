"use client";

import React, { useEffect, useRef, useState, useCallback, TouchEvent, useMemo } from "react";
import { Layout, Button, Space } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

const { Sider, Content } = Layout;

interface AnimatedSidebarProps {
  /** 侧边栏内容 */
  children: ReactNode;
  /** 主内容区域 */
  mainContent: ReactNode;
  /** 展开时的宽度 */
  expandedWidth?: number;
  /** 收起时的宽度 */
  collapsedWidth?: number;
  /** 断点（屏幕宽度小于此值时启用移动端模式） */
  breakpoint?: number;
  /** 初始是否收起（桌面端） */
  defaultCollapsed?: boolean;
  /** 展开宽度过渡时间（毫秒） */
  transitionDuration?: number;
  /** 是否显示遮罩层 */
  showOverlay?: boolean;
  /** 状态变化回调 */
  onCollapseChange?: (collapsed: boolean) => void;
  /** 主题 */
  theme?: "light" | "dark";
  /** 触摸滑动灵敏度 */
  touchSensitivity?: number;
}

export default function AnimatedSidebar({
  children,
  mainContent,
  expandedWidth = 200,
  collapsedWidth = 80,
  breakpoint = 768,
  defaultCollapsed = false,
  transitionDuration = 200,
  showOverlay = true,
  onCollapseChange,
  theme = "dark",
  touchSensitivity = 50,
}: AnimatedSidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [iconRotated, setIconRotated] = useState(!defaultCollapsed);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 检测是否为移动端
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < breakpoint;
      setIsMobile(mobile);
      if (mobile) {
        setMobileDrawerOpen(false);
        setIconRotated(!collapsed);
      } else {
        setIconRotated(!collapsed);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint, collapsed]);

  // 处理侧边栏展开/收起
  const handleCollapseToggle = useCallback(() => {
    if (isMobile) {
      setMobileDrawerOpen((prev) => !prev);
    } else {
      setCollapsed((prev) => {
        const newValue = !prev;
        // 延迟更新图标状态，让动画更自然
        setTimeout(() => {
          setIconRotated(!newValue);
        }, transitionDuration * 0.2);
        onCollapseChange?.(newValue);
        return newValue;
      });
    }
  }, [isMobile, onCollapseChange, transitionDuration]);

  // 处理遮罩层点击
  const handleOverlayClick = useCallback(() => {
    if (isMobile && showOverlay) {
      setMobileDrawerOpen(false);
    }
  }, [isMobile, showOverlay]);

  // 触摸事件处理 - 开始
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    setDragStartX(touch.clientX);
    setIsDragging(true);
  }, []);

  // 触摸事件处理 - 移动
  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const touch = e.touches[0];
    const diff = touch.clientX - dragStartX;

    // 只允许从左向右滑动打开
    if (!mobileDrawerOpen && diff > 0) {
      setDragOffset(Math.min(diff, expandedWidth));
    }
    // 允许从右向左滑动关闭
    else if (mobileDrawerOpen && diff < 0) {
      setDragOffset(Math.max(diff, -expandedWidth));
    }
  }, [isDragging, dragStartX, mobileDrawerOpen, expandedWidth]);

  // 触摸事件处理 - 结束
  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    // 根据滑动距离决定是否切换状态
    if (Math.abs(dragOffset) > touchSensitivity) {
      if (dragOffset > 0) {
        setMobileDrawerOpen(true);
      } else {
        setMobileDrawerOpen(false);
      }
    }

    setDragOffset(0);
  }, [isDragging, dragOffset, touchSensitivity]);

  // 处理键盘事件（ESC键关闭侧边栏）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobile && mobileDrawerOpen) {
        setMobileDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, mobileDrawerOpen]);

  // 动态计算样式
  const sidebarStyle = isMobile
    ? {
        position: "fixed" as const,
        left: mobileDrawerOpen || isDragging ? Math.max(0, dragOffset) : `-${expandedWidth}px`,
        top: 0,
        height: "100vh",
        zIndex: 1000,
        width: `${expandedWidth}px`,
        maxWidth: "80%",
        overflow: "hidden",
        transition: isDragging ? "none" : `left ${transitionDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
        transform: `translateX(${dragOffset}px)`,
      }
    : {
        position: "fixed" as const,
        left: 0,
        top: 0,
        height: "100vh",
        zIndex: 1000,
        width: collapsed ? `${collapsedWidth}px` : `${expandedWidth}px`,
        overflow: "auto",
        transition: `width ${transitionDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
      };

  const contentStyle = {
    marginLeft: isMobile ? 0 : (collapsed ? collapsedWidth : expandedWidth),
    marginTop: isMobile ? 0 : 0,
    transition: isMobile ? "none" : `margin-left ${transitionDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
  };

  const overlayStyle = showOverlay && isMobile
    ? {
        position: "fixed" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        zIndex: 999,
        opacity: mobileDrawerOpen || isDragging ? 1 : 0,
        pointerEvents: (mobileDrawerOpen || isDragging) ? "auto" as const : "none" as const,
        transition: isDragging ? "none" : `opacity ${transitionDuration * 0.8}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
      }
    : { display: "none" };

  return (
    <Layout style={{ minHeight: "100vh", display: "flex", flexDirection: "row" }}>
      {/* 侧边栏 */}
      <Sider
        ref={sidebarRef}
        collapsible={!isMobile}
        collapsed={isMobile ? false : collapsed}
        collapsedWidth={collapsedWidth}
        breakpoint="md"
        style={sidebarStyle}
        theme={theme}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </Sider>

      {/* 移动端遮罩层 */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        style={overlayStyle}
      />

      {/* 主内容区域 */}
      <Content style={contentStyle}>
        {/* 顶部控制栏（可选） */}
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            borderBottom: "1px solid #e8e8e8",
            background: "#fff",
          }}
        >
          <Button
            type="text"
            icon={
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: `transform ${transitionDuration * 0.5}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
                }}
              >
                {iconRotated ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </span>
            }
            onClick={handleCollapseToggle}
            style={{
              transition: `all ${transitionDuration * 0.2}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
              borderRadius: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.04)";
              e.currentTarget.style.transform = "scale(1.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.transform = "scale(1)";
            }}
          />
        </div>

        {/* 主内容 */}
        <div style={{ padding: 16 }}>
          {mainContent}
        </div>
      </Content>
    </Layout>
  );
}
