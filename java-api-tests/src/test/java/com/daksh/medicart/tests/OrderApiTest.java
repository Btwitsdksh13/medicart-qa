package com.daksh.medicart.tests;

import com.daksh.medicart.base.BaseTest;
import org.testng.annotations.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

import static io.restassured.RestAssured.given;
import static io.restassured.module.jsv.JsonSchemaValidator.matchesJsonSchemaInClasspath;
import static org.hamcrest.Matchers.*;
import static org.testng.Assert.assertTrue;

public class OrderApiTest extends BaseTest {

    @Test(description = "Empty cart cannot be checked out")
    public void emptyCart() {
        placeOrder(user, Map.of("paymentMethod", "UPI")).then().statusCode(400).body("error", equalTo("EMPTY_CART"));
    }

    @Test(description = "OTC order succeeds, matches schema, decrements stock and clears cart")
    public void otcOrder() {
        addToCart("M1", 3);
        placeOrder(user, Map.of("paymentMethod", "UPI")).then().statusCode(201)
                .body("status", equalTo("PLACED")).body("paymentStatus", equalTo("PAID"))
                .body(matchesJsonSchemaInClasspath("schemas/order.json"));
        given().get("/api/medicines/M1").then().body("stock", equalTo(97));
        asUser().get("/api/cart").then().body("items.size()", equalTo(0));
    }

    @Test(description = "COD payment stays pending")
    public void codPending() {
        addToCart("M1", 1);
        placeOrder(user, Map.of("paymentMethod", "COD")).then().body("paymentStatus", equalTo("PENDING"));
    }

    @Test(description = "Rx medicine is blocked without prescription")
    public void rxBlocked() {
        addToCart("M3", 1);
        placeOrder(user, Map.of("paymentMethod", "UPI")).then().statusCode(422).body("error", equalTo("PRESCRIPTION_REQUIRED"));
    }

    @Test(description = "Rx medicine is allowed with the user's own prescription")
    public void rxAllowed() {
        String rx = prescription(user);
        addToCart("M3", 1);
        placeOrder(user, Map.of("paymentMethod", "CARD", "prescriptionId", rx)).then().statusCode(201);
    }

    @Test(description = "Another user's prescription is not accepted")
    public void foreignPrescription() {
        String rx = prescription("other-user");
        addToCart("M3", 1);
        placeOrder(user, Map.of("paymentMethod", "UPI", "prescriptionId", rx)).then().statusCode(422);
    }

    @Test(description = "Invalid prescription file type is rejected")
    public void invalidPrescriptionFile() {
        asUser().body(Map.of("fileName", "rx.exe")).post("/api/prescriptions").then().statusCode(400);
    }

    @Test(description = "Payment failure leaves stock and cart untouched")
    public void paymentFailure() {
        addToCart("M1", 2);
        placeOrder(user, Map.of("paymentMethod", "UPI", "simulatePaymentFailure", true)).then().statusCode(402);
        given().get("/api/medicines/M1").then().body("stock", equalTo(100));
        asUser().get("/api/cart").then().body("items.size()", equalTo(1));
    }

    @Test(description = "Idempotency key prevents duplicate orders")
    public void idempotency() {
        addToCart("M1", 2);
        String a = asUser().header("idempotency-key", "k1").body(Map.of("paymentMethod", "UPI")).post("/api/orders").path("id");
        String b = asUser().header("idempotency-key", "k1").body(Map.of("paymentMethod", "UPI")).post("/api/orders").path("id");
        org.testng.Assert.assertEquals(b, a);
        given().get("/api/medicines/M1").then().body("stock", equalTo(98));
    }

    @Test(description = "Only the owner can read an order")
    public void orderOwnership() {
        String id = placedOrderId();
        as("intruder").get("/api/orders/" + id).then().statusCode(403);
    }

    @Test(description = "Happy-path lifecycle PLACED to DELIVERED keeps history")
    public void lifecycle() {
        String id = placedOrderId();
        for (String s : List.of("CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"))
            asUser().body(Map.of("status", s)).post("/api/orders/" + id + "/status").then().statusCode(200).body("status", equalTo(s));
        asUser().get("/api/orders/" + id).then().body("history.status", contains("PLACED", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"));
    }

    @Test(description = "Illegal state jumps are blocked")
    public void illegalTransition() {
        String id = placedOrderId();
        for (String bad : List.of("SHIPPED", "DELIVERED"))
            asUser().body(Map.of("status", bad)).post("/api/orders/" + id + "/status").then().statusCode(409).body("error", equalTo("INVALID_TRANSITION"));
    }

    @Test(description = "Cancel restores stock and initiates refund")
    public void cancelRestoresStock() {
        addToCart("M1", 4);
        String id = placeOrder(user, Map.of("paymentMethod", "UPI")).path("id");
        asUser().body(Map.of("status", "CANCELLED")).post("/api/orders/" + id + "/status").then().body("paymentStatus", equalTo("REFUND_INITIATED"));
        given().get("/api/medicines/M1").then().body("stock", equalTo(100));
    }

    @Test(description = "Concurrent checkouts never oversell the last units")
    public void concurrentCheckoutNoOversell() throws Exception {
        List<String> users = List.of("c1", "c2", "c3", "c4");
        for (String u : users) { addToCart(u, "M4", 2).then().statusCode(201); }
        Map<String, String> rx = new ConcurrentHashMap<>();
        for (String u : users) rx.put(u, prescription(u));
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Future<Integer>> results = new java.util.ArrayList<>();
        for (String u : users)
            results.add(pool.submit(() -> placeOrder(u, Map.of("paymentMethod", "UPI", "prescriptionId", rx.get(u))).statusCode()));
        int ok = 0;
        for (Future<Integer> f : results) if (f.get(10, TimeUnit.SECONDS) == 201) ok++;
        pool.shutdown();
        assertTrue(ok <= 2, "sold more than available stock: " + ok + " orders for 5 units");
        given().get("/api/medicines/M4").then().body("stock", equalTo(5 - ok * 2));
    }
}
