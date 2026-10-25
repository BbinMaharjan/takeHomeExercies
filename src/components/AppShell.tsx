"use client";

import theme from "@/themes/themes";
import { MedicineBoxFilled } from "@ant-design/icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, Layout } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

const { Header, Content } = Layout;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const router = useRouter();

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={theme}>
        <Layout style={{ minHeight: "100vh" }}>
          <Header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "#9C27B0",
              paddingInline: 24,
            }}
          >
            <MedicineBoxFilled style={{ fontSize: 30, color: "#ffffff" }} />
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
      </ConfigProvider>
    </QueryClientProvider>
  );
}
