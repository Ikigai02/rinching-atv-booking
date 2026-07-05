if (method === "toyyibpay") {
      const base = appBaseUrl();
      
      // FIX: Use clean URLs with no query parameters to bypass URI character filtering
      const returnUrl = `${base}/payment-return.html`;
      const callbackUrl = `${base}/api/bookings/payment-callback`;

      const { billCode, redirectUrl } = await toyyibpay.createBill({
        db,
        amount: booking.deposit_amount,
        bookingId: booking.id,
        packageLabel: `${booking.package_code} ${booking.package_name}`,
        bookingDate: booking.booking_date,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        returnUrl: returnUrl,
        callbackUrl: callbackUrl,
      });
      
      db.prepare(
        `INSERT INTO payments (booking_id, amount, method, reference, status, notes)
         VALUES (?, ?, 'toyyibpay', ?, 'pending', 'Awaiting payment')`
      ).run(booking.id, booking.deposit_amount, billCode);
      
      return res.status(201).json({ billCode, redirectUrl, booking: getBookingWithDetails(booking.id) });
    }
