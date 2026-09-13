package com.cocanvas.core;

import com.cocanvas.core.config.CorsProperties;
import com.cocanvas.core.config.InternalProperties;
import com.cocanvas.core.config.JwtProperties;
import com.cocanvas.core.config.SyncServiceProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties({JwtProperties.class, CorsProperties.class, InternalProperties.class, SyncServiceProperties.class})
public class CoreApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(CoreApiApplication.class, args);
    }
}
