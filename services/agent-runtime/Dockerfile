FROM gradle:9.1.0-jdk21-alpine AS build
WORKDIR /workspace
COPY services/agent-runtime ./
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar /app/agent-runtime.jar
EXPOSE 8081
CMD ["java", "-jar", "/app/agent-runtime.jar"]
