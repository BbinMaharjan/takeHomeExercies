"use client";

import { CompassOutlined } from "@ant-design/icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

const { Header, Content } = Layout;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const router = useRouter();

  return (
    <QueryClientProvider client={queryClient}>
      <Layout style={{ minHeight: "100vh" }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: "#001529",
            paddingInline: 24,
          }}
        >
          <CompassOutlined style={{ fontSize: 24, color: "#ffffff" }} />
          <span
            style={{
              color: "#ffffff",
              fontSize: 20,
              fontWeight: 600,
              lineHeight: "32px",
              cursor: "pointer",
            }}
            onClick={() => router.push("/")}
          >
            MedEx
          </span>
        </Header>
        <Content style={{ padding: 0 }}>{children}</Content>
      </Layout>
    </QueryClientProvider>
  );
}
