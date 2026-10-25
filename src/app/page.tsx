"use client";

import { Button, Card, Space, Typography } from "antd";
import { useRouter } from "next/navigation";

const { Title, Text, Paragraph } = Typography;

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        <Card className="shadow-sm">
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <div>
              <Title level={2} style={{ margin: 0 }}>
                MedEx Service Explorer
              </Title>
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Discover healthcare services, compare providers, and find the right care near you.
              </Paragraph>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card size="small" title="Browse services">
                <Text>Explore thousands of healthcare services grouped by provider.</Text>
              </Card>
              <Card size="small" title="Smart filters">
                <Text>Filter by type, category, provider, location, price, and more.</Text>
              </Card>
              <Card size="small" title="Compare providers">
                <Text>View ratings, reviews, and pricing side by side.</Text>
              </Card>
            </div>

            <div className="flex justify-center">
              <Button type="primary" size="large" onClick={() => router.push("/services")}>
                Browse Services
              </Button>
            </div>
          </Space>
        </Card>
      </div>
    </div>
  );
}