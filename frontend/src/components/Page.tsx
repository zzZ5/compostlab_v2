"use client";

import { ReactNode } from "react";
import { Space, Typography } from "antd";

type PageProps = {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
};

export default function Page({ title, extra, children }: PageProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra && <Space wrap>{extra}</Space>}
      </div>

      {children}
    </div>
  );
}
