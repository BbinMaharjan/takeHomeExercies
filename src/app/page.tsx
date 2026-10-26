"use client";

import { Button, Card, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import {
  SearchOutlined,
  ShoppingCartOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Hero Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-900 via-indigo-900 to-slate-900 text-white rounded-3xl p-8 sm:p-12 shadow-xl">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-2xl space-y-4">
            <Tag
              color="blue-inverse"
              className="rounded-full px-3 py-0.5 font-medium tracking-wide text-xs"
            >
              Healthcare Platform Explorer
            </Tag>

            <Title
              level={1}
              className="!text-white !text-3xl sm:!text-5xl !font-extrabold !tracking-tight !m-0"
            >
              MedEx Service Explorer
            </Title>

            <Paragraph className="!text-slate-300 text-base sm:text-lg leading-relaxed !mb-6">
              Explore multi-provider medical services, manage carts across
              providers, and schedule appointments seamlessly across global time
              zones.
            </Paragraph>

            {/* <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="primary"
                size="large"
                icon={<SearchOutlined />}
                className="bg-blue-600 hover:!bg-blue-500 border-none h-12 px-6 rounded-xl font-semibold text-sm shadow-md transition-all duration-200"
                onClick={() => router.push("/services")}
              >
                Explore Services
              </Button>
            </div> */}
          </div>
        </div>

        {/* Feature Grid / Task Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Task 1 Card */}
          <Card
            hoverable
            onClick={() => router.push("/services")}
            className="rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group flex flex-col justify-between"
            styles={{
              body: {
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              },
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                  <SearchOutlined />
                </div>
                <Tag
                  color="blue"
                  className="rounded-md font-semibold text-[11px] px-2 py-0.5"
                >
                  Task 1
                </Tag>
              </div>
              <Title
                level={4}
                className="!text-slate-800 !text-lg !font-bold !mb-2"
              >
                Service Explorer
              </Title>
              <Text className="text-slate-500 text-sm leading-relaxed block mb-6">
                Browse medical services equipped with live faceted filters,
                dynamic search, and custom provider groupings.
              </Text>
            </div>
            <div className="flex items-center gap-1 text-blue-600 font-semibold text-xs group-hover:translate-x-1 transition-transform">
              <span>Launch Explorer</span>
              <ArrowRightOutlined />
            </div>
          </Card>

          {/* Task 2 Card */}
          <Card
            hoverable
            onClick={() => router.push("/cart")}
            className="rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group flex flex-col justify-between"
            styles={{
              body: {
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              },
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                  <ShoppingCartOutlined />
                </div>
                <Tag
                  color="cyan"
                  className="rounded-md font-semibold text-[11px] px-2 py-0.5"
                >
                  Task 2
                </Tag>
              </div>
              <Title
                level={4}
                className="!text-slate-800 !text-lg !font-bold !mb-2"
              >
                Multi-provider Cart & Checkout
              </Title>
              <Text className="text-slate-500 text-sm leading-relaxed block mb-6">
                Manage multi-currency cart orders, merge guest sessions, and
                check out each provider as an isolated transaction.
              </Text>
            </div>
            <div className="flex items-center gap-1 text-indigo-600 font-semibold text-xs group-hover:translate-x-1 transition-transform">
              <span>Open Checkout</span>
              <ArrowRightOutlined />
            </div>
          </Card>

          {/* Task 3 Card */}
          <Card
            hoverable
            onClick={() => router.push("/booking")}
            className="rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group flex flex-col justify-between"
            styles={{
              body: {
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              },
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                  <ClockCircleOutlined />
                </div>
                <Tag
                  color="green"
                  className="rounded-md font-semibold text-[11px] px-2 py-0.5"
                >
                  Task 3
                </Tag>
              </div>
              <Title
                level={4}
                className="!text-slate-800 !text-lg !font-bold !mb-2"
              >
                Time Zone Appointments
              </Title>
              <Text className="text-slate-500 text-sm leading-relaxed block mb-6">
                Book and coordinate healthcare appointments accurately across
                international time zones without scheduling conflicts.
              </Text>
            </div>
            <div className="flex items-center gap-1 text-emerald-600 font-semibold text-xs group-hover:translate-x-1 transition-transform">
              <span>Schedule Appointment</span>
              <ArrowRightOutlined />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
